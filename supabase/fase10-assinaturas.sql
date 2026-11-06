-- Fase 10: assinatura do Bio Site paga pelas barbearias (Stripe).
-- O servidor grava a partir dos avisos do Stripe (lib/assinatura.js); o navegador nunca lê estas tabelas.
-- Aplicada como migração "fase10_assinaturas_stripe".

create table if not exists public.assinaturas (
  barbearia_id uuid primary key references public.barbearias(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'incompleta'
    check (status in ('em_teste', 'ativa', 'atrasada', 'pausada', 'cancelada', 'incompleta')),
  plano text not null default 'normal' check (plano in ('lancamento', 'normal')),
  valor_mensal numeric(10, 2),
  implantacao_paga_em timestamptz,
  primeira_cobranca_em timestamptz,
  proxima_cobranca_em timestamptz,
  cancelar_no_fim boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists assinaturas_plano_status on public.assinaturas (plano, status);

-- Avisos do Stripe já tratados (o Stripe pode reenviar o mesmo aviso)
create table if not exists public.stripe_eventos (
  id text primary key,
  tipo text not null,
  recebido_em timestamptz not null default now()
);

alter table public.assinaturas enable row level security;
alter table public.stripe_eventos enable row level security;
revoke all on public.assinaturas from anon, authenticated;
revoke all on public.stripe_eventos from anon, authenticated;
grant select, insert, update, delete on public.assinaturas to service_role;
grant select, insert, update, delete on public.stripe_eventos to service_role;
