-- Fase 26: migração de outro sistema (Booksy) pelo coletor do admin. Só acréscimos.
--
-- migracoes: o código de uso de cada coleta (só o hash fica guardado), ligado a uma barbearia; vale 2 horas.
--   O coletor roda no navegador onde o Booksy está logado e manda os dados com esse código; a senha do
--   Booksy nunca passa pelo barbeirotop. resumo: o que entrou na última vez.
-- externo: de onde veio o registro ("booksy:<id>"), para a mesma coleta rodar de novo sem duplicar.

create table if not exists public.migracoes (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  origem text not null default 'booksy' check (origem in ('booksy')),
  token_hash text not null unique,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  usado_em timestamptz,
  resumo jsonb
);
alter table public.migracoes enable row level security;
create index if not exists migracoes_barbearia on public.migracoes (barbearia_id, criado_em desc);

alter table public.clientes add column if not exists externo text check (externo is null or char_length(externo) <= 60);
alter table public.profissionais add column if not exists externo text check (externo is null or char_length(externo) <= 60);
alter table public.produtos add column if not exists externo text check (externo is null or char_length(externo) <= 60);
alter table public.pedidos add column if not exists externo text check (externo is null or char_length(externo) <= 60);
alter table public.bloqueios add column if not exists externo text check (externo is null or char_length(externo) <= 60);

create unique index if not exists clientes_externo_unico on public.clientes (barbearia_id, externo) where externo is not null;
create unique index if not exists profissionais_externo_unico on public.profissionais (barbearia_id, externo) where externo is not null;
create unique index if not exists produtos_externo_unico on public.produtos (barbearia_id, externo) where externo is not null;
create unique index if not exists pedidos_externo_unico on public.pedidos (barbearia_id, externo) where externo is not null;
create unique index if not exists bloqueios_externo_unico on public.bloqueios (profissional_id, externo) where externo is not null;
