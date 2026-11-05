-- Fase 9: interessados da página de vendas (index.html).
-- O formulário grava pelo servidor (POST /api/config tipo "lead"), com a chave de serviço.
-- O navegador nunca lê esta tabela: RLS ligado, sem políticas, e sem permissão para anon/authenticated.
-- Aplicada como migração "fase9_interessados_pagina_de_vendas".

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  nome text not null check (char_length(nome) between 2 and 80),
  barbearia text not null check (char_length(barbearia) between 2 and 80),
  cidade text not null default '' check (char_length(cidade) <= 80),
  whatsapp text not null check (whatsapp ~ '^[0-9]{10,13}$'),
  barbeiros text not null default '' check (barbeiros in ('', '1', '2-3', '4-6', '7+')),
  plano text not null default '' check (plano in ('', 'Solo', 'Barbearia', 'Sob medida')),
  pagina text not null default '' check (char_length(pagina) <= 120),
  origem text,
  status text not null default 'novo' check (status in ('novo', 'contatado', 'cliente', 'descartado')),
  atualizado_em timestamptz
);

create index if not exists leads_criado on public.leads (criado_em desc);

alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select, insert, update, delete on public.leads to service_role;

comment on table public.leads is 'Contatos da página de vendas. Só o servidor (service_role) lê e grava.';
