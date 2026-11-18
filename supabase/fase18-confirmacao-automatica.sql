-- Fase 18: a barbearia escolhe se os agendamentos do site entram confirmados sozinhos.
-- Aditivo: uma coluna nova (desligada para todas) e a função criar_pedido aceitando "confirmado".
-- Com a confirmação automática, a trava diária da barbearia conta também os agendamentos confirmados
-- que vieram do site nas últimas 24 h (sem isso, um robô poderia lotar a agenda sem ninguém ver).

alter table public.barbearias add column if not exists confirmacao_automatica boolean not null default false;

create or replace function public.criar_pedido(p jsonb)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_prof uuid := nullif(p->>'profissional_id', '')::uuid;
  v_barb uuid := (p->>'barbearia_id')::uuid;
  v_dia date := (p->>'dia')::date;
  v_hora text := p->>'horario';
  v_status text := coalesce(nullif(p->>'status', ''), 'pendente');
  v_dur int := coalesce(nullif(p->>'duracao_min', '')::int, 30);
  v_origem text := nullif(p->>'origem', '');
  v_clube uuid := nullif(p->>'clube_assinante_id', '')::uuid;
  v_valor numeric := nullif(p->>'valor', '')::numeric;
  v_comissao numeric := null;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini int;
  v_conflito text;
  v_n int;
  v_id uuid;
  v_aberto date;
  v_ultimo date;
  a record;
begin
  if v_hora is null or v_hora !~ '^\d{2}:\d{2}$' then
    raise exception 'horario invalido' using errcode = '22023';
  end if;
  if v_status not in ('pendente', 'avulso', 'confirmado') then
    raise exception 'status invalido' using errcode = '22023';
  end if;
  v_ini := minutos_do_horario(v_hora);

  if v_origem is not null then
    perform pg_advisory_xact_lock(hashtextextended('origem:' || v_origem, 0));
    select count(*) into v_n from pedidos where origem = v_origem and criado_em > now() - interval '1 hour';
    if v_n >= coalesce(nullif(p->>'limite_hora_origem', '')::int, 6) then
      return jsonb_build_object('erro', 'limite_origem');
    end if;
    select count(*) into v_n from pedidos where origem = v_origem and criado_em > now() - interval '24 hours';
    if v_n >= coalesce(nullif(p->>'limite_dia_origem', '')::int, 15) then
      return jsonb_build_object('erro', 'limite_origem');
    end if;
  end if;
  if nullif(p->>'limite_dia_barbearia', '') is not null then
    select count(*) into v_n from pedidos
    where barbearia_id = v_barb and simulado = false and criado_em > now() - interval '24 hours'
      and (status = 'pendente' or (v_status = 'confirmado' and status = 'confirmado' and origem is not null));
    if v_n >= (p->>'limite_dia_barbearia')::int then
      return jsonb_build_object('erro', 'limite_barbearia');
    end if;
  end if;

  if v_clube is not null then
    perform pg_advisory_xact_lock(hashtextextended('clube:' || v_clube::text, 0));
    select s.barbearia_id, s.status, s.pago_ate, pl.ativo as plano_ativo, pl.servicos, pl.intervalo_dias,
           pl.dias_semana, pl.hora_limite, pl.comissao_valor
      into a
      from clube_assinantes s join clube_planos pl on pl.id = s.plano_id
     where s.id = v_clube;
    if not found or a.barbearia_id is distinct from v_barb then
      return jsonb_build_object('erro', 'clube', 'motivo', 'assinante');
    end if;
    if a.status <> 'ativo' or not a.plano_ativo then
      return jsonb_build_object('erro', 'clube', 'motivo', 'inativo');
    end if;
    if a.pago_ate is not null and a.pago_ate < v_dia then
      return jsonb_build_object('erro', 'clube', 'motivo', 'vencido', 'data', a.pago_ate);
    end if;
    if not ((p->>'servico') = any (a.servicos)) then
      return jsonb_build_object('erro', 'clube', 'motivo', 'servico');
    end if;
    if not (extract(dow from v_dia)::int = any (a.dias_semana)) then
      return jsonb_build_object('erro', 'clube', 'motivo', 'dia');
    end if;
    if a.hora_limite is not null and v_ini >= minutos_do_horario(a.hora_limite) then
      return jsonb_build_object('erro', 'clube', 'motivo', 'horario', 'limite', a.hora_limite);
    end if;
    select min(x.dia) into v_aberto from pedidos x
     where x.clube_assinante_id = v_clube and x.status in ('pendente', 'confirmado', 'avulso') and x.dia >= v_hoje;
    if v_aberto is not null then
      return jsonb_build_object('erro', 'clube', 'motivo', 'aberto', 'data', v_aberto);
    end if;
    select max(x.dia) into v_ultimo from pedidos x
     where x.clube_assinante_id = v_clube and x.dia <= v_dia
       and (x.status in ('pendente', 'confirmado', 'avulso', 'realizado')
            or (x.status = 'nao_realizado' and coalesce(x.motivo, '') <> 'reagendado'));
    if v_ultimo is not null and v_dia < v_ultimo + a.intervalo_dias then
      return jsonb_build_object('erro', 'clube', 'motivo', 'intervalo', 'data', v_ultimo + a.intervalo_dias);
    end if;
    v_valor := 0;
    v_comissao := a.comissao_valor;
  end if;

  if v_prof is not null then
    perform pg_advisory_xact_lock(hashtextextended('agenda:' || v_prof::text || ':' || v_dia::text, 0));
    select x.horario into v_conflito
    from pedidos x
    where x.profissional_id = v_prof
      and x.dia = v_dia
      and x.simulado = false
      and x.status in ('pendente', 'confirmado', 'avulso', 'realizado')
      and minutos_do_horario(x.horario) < v_ini + v_dur
      and v_ini < minutos_do_horario(x.horario) + coalesce(x.duracao_min, 30)
    order by x.horario
    limit 1;
    if v_conflito is not null then
      return jsonb_build_object('erro', 'conflito', 'horario', left(v_conflito, 5));
    end if;
  end if;

  insert into pedidos (slug, barbearia_id, profissional_id, codigo, servico, profissional, dia, horario, horario_fim,
                       cliente, observacao, duracao_min, valor, status, origem, clube_assinante_id, comissao_valor)
  values (
    p->>'slug', v_barb, v_prof, p->>'codigo', p->>'servico', coalesce(p->>'profissional', ''), v_dia, v_hora,
    lpad(((v_ini + v_dur) / 60)::text, 2, '0') || ':' || lpad(((v_ini + v_dur) % 60)::text, 2, '0'),
    p->>'cliente', coalesce(p->>'observacao', ''), v_dur, v_valor, v_status, v_origem, v_clube, v_comissao
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'clube', v_clube is not null);
end;
$function$;
