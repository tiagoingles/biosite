-- Fase 14: cadastro de clientes da barbearia (carteira), convite de cadastro pelo celular do cliente,
-- vínculo do atendimento com o cliente e campanhas enviadas uma a uma pelo WhatsApp do dono.
-- O agendamento continua sem conta: o cliente é reconhecido pelo WhatsApp (opcional no site).
-- Só acrescenta: tabelas novas, uma coluna nova em pedidos e duas funções; nada existente muda.
-- Aplicada como migração "fase14_clientes".

create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  nome text not null check (char_length(btrim(nome)) between 2 and 80),
  -- Só números com DDD (10 ou 11 dígitos), como no clube de assinatura
  telefone text check (telefone ~ '^[1-9][0-9]{9,10}$'),
  -- Opcional (LGPD: coleta mínima); só os 11 números, conferidos no servidor
  cpf text check (cpf ~ '^[0-9]{11}$'),
  nascimento date check (nascimento between date '1900-01-01' and date '2100-12-31'),
  observacao text not null default '' check (char_length(observacao) <= 300),
  -- Barbeiro de referência (quem cadastrou ou atende); a carteira do barbeiro também usa as visitas
  profissional_id uuid references public.profissionais(id) on delete set null,
  origem text not null default 'painel' check (origem in ('painel', 'importacao', 'site', 'convite')),
  -- Última visita trazida da planilha, de antes do Bio Site
  ultima_visita_externa date,
  -- Aceite para receber promoções e novidades (marketing): quando e por onde foi dado
  aceita_novidades boolean not null default false,
  aceite_em timestamptz,
  aceite_origem text check (aceite_origem in ('painel', 'importacao', 'site', 'convite')),
  -- Pediu para sair (não recebe mais mensagem de marketing)
  saiu_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- Telefone e CPF não se repetem na mesma barbearia (vazio pode repetir)
  constraint clientes_telefone_unico unique (barbearia_id, telefone),
  constraint clientes_cpf_unico unique (barbearia_id, cpf)
);
create index if not exists clientes_barbearia_nome on public.clientes (barbearia_id, nome);
create index if not exists clientes_profissional on public.clientes (profissional_id);

alter table public.clientes enable row level security;
revoke all on public.clientes from anon, authenticated;
grant select, insert, update, delete on public.clientes to service_role;

-- Atendimento ligado ao cliente (histórico, dias sem voltar). Apagar o cliente não apaga o atendimento.
alter table public.pedidos add column if not exists cliente_id uuid references public.clientes(id) on delete set null;
create index if not exists pedidos_cliente on public.pedidos (cliente_id) where cliente_id is not null;

-- Convite de cadastro: link (ou QR code) que o cliente abre no próprio celular. Uso único, com validade.
create table if not exists public.clientes_convites (
  token text primary key check (char_length(token) between 20 and 64),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  pedido_id uuid references public.pedidos(id) on delete set null,
  profissional_id uuid references public.profissionais(id) on delete set null,
  nome text not null default '' check (char_length(nome) <= 80),
  telefone text check (telefone ~ '^[1-9][0-9]{9,10}$'),
  expira_em timestamptz not null,
  usado_em timestamptz,
  cliente_id uuid references public.clientes(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists clientes_convites_barbearia on public.clientes_convites (barbearia_id, criado_em);
create index if not exists clientes_convites_pedido on public.clientes_convites (pedido_id);
create index if not exists clientes_convites_profissional on public.clientes_convites (profissional_id);
create index if not exists clientes_convites_cliente on public.clientes_convites (cliente_id);

alter table public.clientes_convites enable row level security;
revoke all on public.clientes_convites from anon, authenticated;
grant select, insert, update, delete on public.clientes_convites to service_role;

-- Campanha: uma mensagem para um grupo de clientes, enviada uma a uma pelo WhatsApp do dono
create table if not exists public.campanhas (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 80),
  segmento text not null default '' check (char_length(segmento) <= 40),
  mensagem text not null check (char_length(mensagem) between 2 and 1000),
  criado_em timestamptz not null default now()
);
create index if not exists campanhas_barbearia on public.campanhas (barbearia_id, criado_em desc);

create table if not exists public.campanha_envios (
  campanha_id uuid not null references public.campanhas(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  enviado_em timestamptz not null default now(),
  primary key (campanha_id, cliente_id)
);
create index if not exists campanha_envios_cliente on public.campanha_envios (cliente_id);

alter table public.campanhas enable row level security;
alter table public.campanha_envios enable row level security;
revoke all on public.campanhas from anon, authenticated;
revoke all on public.campanha_envios from anon, authenticated;
grant select, insert, update, delete on public.campanhas to service_role;
grant select, insert, update, delete on public.campanha_envios to service_role;

-- Agendamento pelo site com WhatsApp: acha (ou cria) o cliente pelo número e liga o pedido a ele.
-- O aceite de novidades só é acrescentado: desmarcar no site não tira um aceite dado antes,
-- e marcar de novo depois de ter saído volta a valer. O nome cadastrado não é trocado.
create or replace function public.cliente_do_agendamento(p_barbearia uuid, p_pedido uuid, p_nome text, p_telefone text, p_novidades boolean)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_aceita boolean := coalesce(p_novidades, false);
begin
  if p_telefone is null or p_telefone !~ '^[1-9][0-9]{9,10}$' then
    return null;
  end if;
  insert into clientes (barbearia_id, nome, telefone, origem, aceita_novidades, aceite_em, aceite_origem)
  values (p_barbearia, left(btrim(p_nome), 80), p_telefone, 'site', v_aceita,
          case when v_aceita then now() end, case when v_aceita then 'site' end)
  on conflict (barbearia_id, telefone) do update set
    aceite_em = case when excluded.aceita_novidades and not clientes.aceita_novidades then now() else clientes.aceite_em end,
    aceite_origem = case when excluded.aceita_novidades and not clientes.aceita_novidades then 'site' else clientes.aceite_origem end,
    aceita_novidades = clientes.aceita_novidades or excluded.aceita_novidades,
    saiu_em = case when excluded.aceita_novidades then null else clientes.saiu_em end,
    atualizado_em = now()
  returning id into v_id;
  update pedidos set cliente_id = v_id
   where id = p_pedido and barbearia_id = p_barbearia and cliente_id is null;
  return v_id;
end;
$function$;

-- Cadastro pelo convite: confere o convite (uso único, dentro da validade), cria o cliente ou completa
-- o cadastro de quem já tem o mesmo WhatsApp (sem trocar o que já estava preenchido), liga o
-- atendimento do convite e marca o convite como usado, tudo numa operação só.
create or replace function public.cliente_do_convite(p_token text, p_nome text, p_telefone text, p_cpf text, p_nascimento date, p_novidades boolean)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  c record;
  v_id uuid;
  v_aceita boolean := coalesce(p_novidades, false);
begin
  select * into c from clientes_convites where token = p_token for update;
  if not found then
    return jsonb_build_object('erro', 'convite');
  end if;
  if c.usado_em is not null then
    return jsonb_build_object('erro', 'usado');
  end if;
  if c.expira_em < now() then
    return jsonb_build_object('erro', 'expirado');
  end if;

  select id into v_id from clientes where barbearia_id = c.barbearia_id and telefone = p_telefone for update;
  if found then
    update clientes set
      cpf = coalesce(clientes.cpf, p_cpf),
      nascimento = coalesce(clientes.nascimento, p_nascimento),
      aceite_em = case when v_aceita and not clientes.aceita_novidades then now() else clientes.aceite_em end,
      aceite_origem = case when v_aceita and not clientes.aceita_novidades then 'convite' else clientes.aceite_origem end,
      aceita_novidades = clientes.aceita_novidades or v_aceita,
      saiu_em = case when v_aceita then null else clientes.saiu_em end,
      profissional_id = coalesce(clientes.profissional_id, c.profissional_id),
      atualizado_em = now()
    where id = v_id;
  else
    insert into clientes (barbearia_id, nome, telefone, cpf, nascimento, origem, profissional_id, aceita_novidades, aceite_em, aceite_origem)
    values (c.barbearia_id, left(btrim(p_nome), 80), p_telefone, p_cpf, p_nascimento, 'convite', c.profissional_id, v_aceita,
            case when v_aceita then now() end, case when v_aceita then 'convite' end)
    returning id into v_id;
  end if;

  if c.pedido_id is not null then
    update pedidos set cliente_id = v_id where id = c.pedido_id and barbearia_id = c.barbearia_id and cliente_id is null;
  end if;
  update clientes_convites set usado_em = now(), cliente_id = v_id where token = p_token;
  return jsonb_build_object('ok', true, 'cliente_id', v_id);
exception
  when unique_violation then
    -- O CPF informado já está em outro cliente desta barbearia
    return jsonb_build_object('erro', 'cpf');
end;
$function$;

revoke execute on function public.cliente_do_agendamento(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke execute on function public.cliente_do_convite(text, text, text, text, date, boolean) from public, anon, authenticated;
grant execute on function public.cliente_do_agendamento(uuid, uuid, text, text, boolean) to service_role;
grant execute on function public.cliente_do_convite(text, text, text, text, date, boolean) to service_role;
