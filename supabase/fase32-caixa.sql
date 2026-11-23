-- Fase 32: caixa do dia (pedido do Manolo, Dom Manolo, 19/11). O dono abre o dia com o troco da gaveta,
-- registra retirada (sangria) e reforço, e fecha contando o dinheiro: o sistema compara com o esperado
-- (troco + dinheiro que entrou + reforços − retiradas) e guarda a foto do fechamento.
-- As entradas vêm da forma de pagamento (fase 31) dos atendimentos realizados e das vendas de produto do dia.
-- Aditivo: duas tabelas novas. RLS ligado sem políticas: só o servidor lê e escreve.

create table if not exists public.caixas (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  dia date not null,
  troco numeric(10,2) not null default 0 check (troco >= 0),
  aberto_em timestamptz not null default now(),
  aberto_por uuid,
  fechado_em timestamptz,
  contado numeric(10,2) check (contado is null or contado >= 0),
  esperado numeric(10,2),
  resumo jsonb,
  observacao text not null default '' check (char_length(observacao) <= 300),
  unique (barbearia_id, dia)
);

create table if not exists public.caixa_movimentos (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.caixas(id) on delete cascade,
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  tipo text not null check (tipo in ('retirada', 'reforco')),
  valor numeric(10,2) not null check (valor > 0),
  motivo text not null default '' check (char_length(motivo) <= 80),
  criado_em timestamptz not null default now()
);
create index if not exists caixa_movimentos_caixa on public.caixa_movimentos (caixa_id);

alter table public.caixas enable row level security;
alter table public.caixa_movimentos enable row level security;
