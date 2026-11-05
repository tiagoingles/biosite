-- Fase 8: segurança, desempenho e monitoramento. Aditivo: não apaga dados nem colunas.
-- Rodar no SQL Editor do Supabase (ou aplicar como migração) depois das fases anteriores.

-- 1) Defesa em profundidade. O navegador nunca lê as tabelas direto: tudo passa pelas rotas
--    da API com a chave de serviço. O RLS já bloqueava; agora anon e authenticated também
--    perdem os privilégios (inclusive TRUNCATE, que o RLS não cobre).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- 2) Índices: chaves estrangeiras sem índice e as consultas mais frequentes dos painéis
create index if not exists pedidos_barbearia_dia on public.pedidos (barbearia_id, dia);
create index if not exists pedidos_barbearia_status_dia on public.pedidos (barbearia_id, status, dia);
create index if not exists pedidos_barbearia_criado on public.pedidos (barbearia_id, criado_em);
create index if not exists convites_barbearia on public.convites (barbearia_id);
create index if not exists convites_email on public.convites (email);
create index if not exists despesas_barbearia on public.despesas (barbearia_id);
create index if not exists push_inscricoes_user on public.push_inscricoes (user_id);
create index if not exists barbearias_teste_user on public.barbearias (teste_user_id);

-- 3) Origem do pedido: hash do IP (o IP em si não é guardado), para limitar abuso
alter table public.pedidos add column if not exists origem text check (origem is null or char_length(origem) <= 64);
create index if not exists pedidos_origem_criado on public.pedidos (origem, criado_em) where origem is not null;

-- 4) Storage: só os tipos de arquivo que o sistema aceita, até 25 MB
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']
where id = 'midia';

-- 5) Tentativas (senha do Criador, código do painel, limites por origem)
create table if not exists public.tentativas (
  id bigint generated always as identity primary key,
  chave text not null check (char_length(chave) <= 120),
  criado_em timestamptz not null default now()
);
create index if not exists tentativas_chave_criado on public.tentativas (chave, criado_em);
alter table public.tentativas enable row level security;

-- Conta as tentativas de uma chave na janela (e registra uma nova, se pedido)
create or replace function public.contar_tentativa(p_chave text, p_janela_seg int, p_registrar boolean)
returns int
language plpgsql
set search_path = public
as $$
declare
  v_chave text := left(p_chave, 120);
  n int;
begin
  if random() < 0.02 then
    delete from tentativas where criado_em < now() - interval '2 days';
  end if;
  if p_registrar then
    insert into tentativas (chave) values (v_chave);
  end if;
  select count(*) into n from tentativas where chave = v_chave and criado_em > now() - make_interval(secs => p_janela_seg);
  return n;
end;
$$;

-- 6) Monitoramento: erros do servidor e do navegador, Web Vitals e checagens de saúde
create table if not exists public.telemetria (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('erro_servidor', 'erro_navegador', 'vital', 'saude')),
  rota text not null default '' check (char_length(rota) <= 200),
  nome text not null default '' check (char_length(nome) <= 80),
  valor numeric,
  detalhe text not null default '' check (char_length(detalhe) <= 2000),
  ref text not null default '' check (char_length(ref) <= 40)
);
create index if not exists telemetria_tipo_criado on public.telemetria (tipo, criado_em desc);
alter table public.telemetria enable row level security;

create or replace function public.resumo_saude(p_horas int default 24)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'horas', p_horas,
    'erros_servidor', (select count(*) from telemetria where tipo = 'erro_servidor' and criado_em > now() - make_interval(hours => p_horas)),
    'erros_navegador', (select count(*) from telemetria where tipo = 'erro_navegador' and criado_em > now() - make_interval(hours => p_horas)),
    'vitais', (
      select coalesce(jsonb_object_agg(nome, jsonb_build_object('p75', round(p75::numeric, 1), 'amostras', n)), '{}'::jsonb)
      from (
        select nome, percentile_cont(0.75) within group (order by valor) as p75, count(*) as n
        from telemetria
        where tipo = 'vital' and valor is not null and criado_em > now() - make_interval(hours => p_horas)
        group by nome
      ) v
    ),
    'ultimos_erros', (
      select coalesce(jsonb_agg(e order by e.criado_em desc), '[]'::jsonb)
      from (
        select criado_em, tipo, rota, nome, left(detalhe, 300) as detalhe, ref
        from telemetria
        where tipo in ('erro_servidor', 'erro_navegador') and criado_em > now() - make_interval(hours => p_horas)
        order by criado_em desc
        limit 20
      ) e
    ),
    'pedidos_24h', (select count(*) from pedidos where simulado = false and criado_em > now() - interval '24 hours')
  )
$$;

-- 7) Pedido gravado de forma atômica: trava a agenda do profissional naquele dia, confere
--    conflito de horário e os limites de abuso, e só então grava. Dois clientes clicando
--    no mesmo horário ao mesmo tempo: só um consegue.
create or replace function public.minutos_do_horario(h text)
returns int
language sql
immutable
parallel safe
set search_path = public
as $$
  select case when h ~ '^\d{1,2}:\d{2}' then split_part(h, ':', 1)::int * 60 + left(split_part(h, ':', 2), 2)::int end
$$;

create or replace function public.criar_pedido(p jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_prof uuid := nullif(p->>'profissional_id', '')::uuid;
  v_barb uuid := (p->>'barbearia_id')::uuid;
  v_dia date := (p->>'dia')::date;
  v_hora text := p->>'horario';
  v_status text := coalesce(nullif(p->>'status', ''), 'pendente');
  v_dur int := coalesce(nullif(p->>'duracao_min', '')::int, 30);
  v_origem text := nullif(p->>'origem', '');
  v_ini int;
  v_conflito text;
  v_n int;
  v_id uuid;
begin
  if v_hora is null or v_hora !~ '^\d{2}:\d{2}$' then
    raise exception 'horario invalido' using errcode = '22023';
  end if;
  if v_status not in ('pendente', 'avulso') then
    raise exception 'status invalido' using errcode = '22023';
  end if;
  v_ini := minutos_do_horario(v_hora);

  -- Limites contra abuso: por origem (hash do IP) e por barbearia
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

  -- Conflito de horário do mesmo profissional (trava por profissional e dia)
  if v_prof is not null then
    perform pg_advisory_xact_lock(hashtextextended('agenda:' || v_prof::text || ':' || v_dia::text, 0));
    select x.horario into v_conflito
    from pedidos x
    where x.profissional_id = v_prof
      and x.dia = v_dia
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
                       cliente, observacao, duracao_min, valor, status, origem)
  values (
    p->>'slug', v_barb, v_prof, p->>'codigo', p->>'servico', coalesce(p->>'profissional', ''), v_dia, v_hora,
    lpad(((v_ini + v_dur) / 60)::text, 2, '0') || ':' || lpad(((v_ini + v_dur) % 60)::text, 2, '0'),
    p->>'cliente', coalesce(p->>'observacao', ''), v_dur, nullif(p->>'valor', '')::numeric, v_status, v_origem
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Só o servidor (service_role) chama estas funções
revoke all on function public.contar_tentativa(text, int, boolean) from public, anon, authenticated;
revoke all on function public.resumo_saude(int) from public, anon, authenticated;
revoke all on function public.minutos_do_horario(text) from public, anon, authenticated;
revoke all on function public.criar_pedido(jsonb) from public, anon, authenticated;
grant execute on function public.contar_tentativa(text, int, boolean) to service_role;
grant execute on function public.resumo_saude(int) to service_role;
grant execute on function public.minutos_do_horario(text) to service_role;
grant execute on function public.criar_pedido(jsonb) to service_role;
grant all on public.tentativas to service_role;
grant all on public.telemetria to service_role;
