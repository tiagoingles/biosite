-- Fase 23: app da barbearia no celular do cliente, confirmação de presença antes do horário e avisos
-- que o dono manda para um cliente ou um grupo (ex.: Sumidos). Aditivo: colunas novas, duas tabelas,
-- um tipo de aviso a mais na lista e uma faxina agendada nova.

-- Pedir ao cliente que confirme a presença X minutos antes (null = não pedir)
alter table public.barbearias add column if not exists pedir_confirmacao_min smallint
  check (pedir_confirmacao_min is null or pedir_confirmacao_min between 30 and 1440);

-- Resposta do cliente: 'sim' confirmou; 'nao' cancelou pelo celular (o horário volta a ficar livre)
alter table public.pedidos add column if not exists cliente_resposta text check (cliente_resposta in ('sim', 'nao'));
alter table public.pedidos add column if not exists cliente_respondeu_em timestamptz;

-- O pedido de confirmação também sai uma vez só por atendimento (trava em avisos_pedido)
alter table public.avisos_pedido drop constraint if exists avisos_pedido_tipo_check;
alter table public.avisos_pedido add constraint avisos_pedido_tipo_check
  check (tipo in ('chega', 'cliente30', 'atraso', 'cliente_atraso', 'confirmar'));

-- Celulares de clientes com os avisos da barbearia ligados (o "app" da barbearia): um por aparelho e
-- barbearia. Fica ligado ao cadastro do cliente quando ele agenda pelo site com o WhatsApp.
-- novidades = o cliente aceitou receber novidades e promoções (o botão do site diz isso).
create table if not exists public.clientes_push (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete cascade,
  endpoint text not null check (char_length(endpoint) <= 2000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth_key text not null check (char_length(auth_key) <= 100),
  novidades boolean not null default false,
  criado_em timestamptz not null default now(),
  visto_em timestamptz not null default now(),
  unique (barbearia_id, endpoint)
);
create index if not exists clientes_push_cliente on public.clientes_push (cliente_id) where cliente_id is not null;
alter table public.clientes_push enable row level security;

-- Avisos que o dono mandou (histórico e limite por dia)
create table if not exists public.avisos_clientes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  segmento text check (segmento is null or char_length(segmento) <= 40),
  mensagem text not null check (char_length(mensagem) <= 300),
  aparelhos int not null default 0,
  entregues int not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists avisos_clientes_barbearia on public.avisos_clientes (barbearia_id, criado_em desc);
alter table public.avisos_clientes enable row level security;

-- Faxina: aparelho que não aparece há mais de 400 dias e histórico antigo saem
select cron.schedule(
  'biosite-faxina-app-clientes',
  '27 6 * * *',
  $$
    delete from public.clientes_push where visto_em < now() - interval '400 days';
    delete from public.avisos_clientes where criado_em < now() - interval '400 days';
  $$
);
