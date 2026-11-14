-- Fase 13: lembrete de vencimento do clube de assinatura.
-- O painel lista quem vence nos próximos 3 dias ou já venceu, o dono lembra pelo WhatsApp e o painel
-- anota o lembrete. De manhã, o dono recebe um aviso no celular se houver alguém para lembrar.
-- Só acrescenta: dois campos no assinante, uma tabela e um índice; nada existente muda.
-- Aplicada como migração "fase13_clube_lembretes".

-- Último lembrete enviado ao assinante pelo painel e o vencimento a que ele se referia.
-- Um "Recebi" muda o pago_ate, e o lembrete antigo deixa de contar para o vencimento novo.
alter table public.clube_assinantes add column if not exists lembrete_em timestamptz;
alter table public.clube_assinantes add column if not exists lembrete_pago_ate date;

-- Aviso diário no celular do dono (Web Push): no máximo um por barbearia por dia.
-- A chave primária é a trava: a segunda chamada do dia não consegue gravar e não avisa de novo.
create table if not exists public.clube_avisos_diarios (
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  dia date not null,
  assinantes integer not null default 0 check (assinantes >= 0),
  criado_em timestamptz not null default now(),
  primary key (barbearia_id, dia)
);

alter table public.clube_avisos_diarios enable row level security;
revoke all on public.clube_avisos_diarios from anon, authenticated;
grant select, insert, update, delete on public.clube_avisos_diarios to service_role;

-- O aviso diário procura, em todas as barbearias, os assinantes ativos perto do vencimento
create index if not exists clube_assinantes_vencimento on public.clube_assinantes (pago_ate) where status = 'ativo';
