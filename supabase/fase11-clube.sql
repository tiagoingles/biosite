-- Fase 11: clube de assinatura da barbearia (versão manual: a barbearia recebe por fora e cadastra o assinante).
-- O assinante marca pelo site informando o WhatsApp; as regras do plano são conferidas dentro de criar_pedido,
-- com trava por assinante, para dois pedidos ao mesmo tempo não furarem o intervalo.
-- Aplicada como migração "fase11_clube_assinatura".

create table if not exists public.clube_planos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 60),
  descricao text not null default '' check (char_length(descricao) <= 160),
  preco numeric(10, 2) not null check (preco > 0 and preco < 10000),
  servicos text[] not null check (cardinality(servicos) between 1 and 30),
  intervalo_dias int not null default 7 check (intervalo_dias between 0 and 60),
  dias_semana int[] not null default '{0,1,2,3,4,5,6}' check (cardinality(dias_semana) between 1 and 7 and dias_semana <@ '{0,1,2,3,4,5,6}'),
  hora_limite text check (hora_limite ~ '^\d{2}:\d{2}$'),
  comissao_valor numeric(10, 2) not null default 0 check (comissao_valor >= 0 and comissao_valor < 1000),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists clube_planos_barbearia on public.clube_planos (barbearia_id);

create table if not exists public.clube_assinantes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  plano_id uuid not null references public.clube_planos(id),
  nome text not null check (char_length(nome) between 2 and 80),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,11}$'),
  status text not null default 'ativo' check (status in ('ativo', 'pausado', 'cancelado')),
  pago_ate date,
  observacao text not null default '' check (char_length(observacao) <= 200),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (barbearia_id, whatsapp)
);
create index if not exists clube_assinantes_plano on public.clube_assinantes (plano_id);

-- Pedido feito pelo clube: quem é o assinante e a comissão fixa do barbeiro (o cliente não paga no balcão)
alter table public.pedidos add column if not exists clube_assinante_id uuid references public.clube_assinantes(id) on delete set null;
alter table public.pedidos add column if not exists comissao_valor numeric(10, 2);
create index if not exists pedidos_clube on public.pedidos (clube_assinante_id, dia) where clube_assinante_id is not null;

alter table public.clube_planos enable row level security;
alter table public.clube_assinantes enable row level security;
revoke all on public.clube_planos from anon, authenticated;
revoke all on public.clube_assinantes from anon, authenticated;
grant select, insert, update, delete on public.clube_planos to service_role;
grant select, insert, update, delete on public.clube_assinantes to service_role;

-- criar_pedido com as regras do clube (o resto igual à fase 8b)
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
  if v_status not in ('pendente', 'avulso') then
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
    where barbearia_id = v_barb and status = 'pendente' and simulado = false and criado_em > now() - interval '24 hours';
    if v_n >= (p->>'limite_dia_barbearia')::int then
      return jsonb_build_object('erro', 'limite_barbearia');
    end if;
  end if;

  -- Clube de assinatura: o assinante só marca dentro das regras do plano
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
    -- Um horário pelo clube em aberto por vez
    select min(x.dia) into v_aberto from pedidos x
     where x.clube_assinante_id = v_clube and x.status in ('pendente', 'confirmado', 'avulso') and x.dia >= v_hoje;
    if v_aberto is not null then
      return jsonb_build_object('erro', 'clube', 'motivo', 'aberto', 'data', v_aberto);
    end if;
    -- Intervalo mínimo desde o último uso (falta conta como uso; remarcação não)
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
