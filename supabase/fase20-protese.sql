-- Fase 20: prótese capilar. Aba própria no painel do dono com a ficha de cada cliente de prótese,
-- a próxima manutenção (última manutenção + intervalo), o lembrete pelo WhatsApp e o histórico.
-- Aditivo: uma coluna nova em barbearias e duas tabelas. RLS ligado sem políticas: só o servidor.

alter table public.barbearias add column if not exists protese_ativa boolean not null default false;

create table if not exists public.protese_clientes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  nome text not null check (char_length(nome) between 1 and 80),
  telefone text not null default '' check (char_length(telefone) <= 15),
  profissional_id uuid references public.profissionais(id) on delete set null,
  modelo text not null default '' check (char_length(modelo) <= 120),
  aplicada_em date,
  intervalo_dias int not null default 21 check (intervalo_dias between 7 and 120),
  ultima_manutencao date,
  lembrete_em timestamptz,
  observacao text not null default '' check (char_length(observacao) <= 500),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists protese_clientes_barbearia on public.protese_clientes (barbearia_id);

create table if not exists public.protese_manutencoes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  protese_cliente_id uuid not null references public.protese_clientes(id) on delete cascade,
  dia date not null,
  tipo text not null default 'manutencao' check (tipo in ('aplicacao', 'manutencao', 'troca')),
  profissional_id uuid references public.profissionais(id) on delete set null,
  pedido_id uuid references public.pedidos(id) on delete set null,
  observacao text not null default '' check (char_length(observacao) <= 300),
  criado_em timestamptz not null default now()
);
create index if not exists protese_manutencoes_cliente on public.protese_manutencoes (protese_cliente_id, dia desc);
create unique index if not exists protese_manutencoes_pedido on public.protese_manutencoes (pedido_id) where pedido_id is not null;

alter table public.protese_clientes enable row level security;
alter table public.protese_manutencoes enable row level security;
