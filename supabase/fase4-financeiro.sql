-- Fase 4: financeiro do dono (faturamento, comissão, gastos fixos, insumos) e simulação de 30 dias.
-- Rodar no SQL Editor do Supabase depois das fases anteriores. Aditivo: não apaga dados.
-- Como nas outras tabelas, o RLS fica ligado sem políticas: só o servidor (service_role) lê e escreve.

-- Comissão de cada profissional, em % sobre o valor do atendimento realizado (padrão 40%).
alter table profissionais add column if not exists comissao_pct numeric(5,2) not null default 40
  check (comissao_pct between 0 and 100);

-- Valor e comissão ficam gravados no pedido quando o atendimento é encerrado como realizado.
-- Assim, mudar o preço ou a comissão depois não altera o histórico.
alter table pedidos add column if not exists valor numeric(10,2) check (valor is null or valor >= 0);
alter table pedidos add column if not exists comissao_pct numeric(5,2)
  check (comissao_pct is null or comissao_pct between 0 and 100);

-- Marca os dados de simulação, para o administrador poder zerá-los sem tocar nos dados reais.
alter table pedidos add column if not exists simulado boolean not null default false;

-- Preço de cada serviço, por nome (o site guarda o nome do serviço no pedido).
create table if not exists servicos_precos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 80),
  preco numeric(10,2) not null check (preco >= 0),
  simulado boolean not null default false,
  unique (barbearia_id, nome)
);

-- Gastos fixos mensais (aluguel, energia, software...). Entram no resumo proporcionalmente aos dias.
create table if not exists despesas (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  descricao text not null check (char_length(descricao) between 1 and 80),
  categoria text not null default 'outros',
  valor numeric(10,2) not null check (valor >= 0),
  ativo boolean not null default true,
  simulado boolean not null default false,
  criado_em timestamptz not null default now()
);

-- Insumos (pomada, lâmina, óleo...) e o controle de estoque por movimentos.
create table if not exists insumos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 80),
  unidade text not null default 'un',
  estoque_minimo numeric(10,2) not null default 0 check (estoque_minimo >= 0),
  simulado boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (barbearia_id, nome)
);

-- Entrada = compra (com valor pago); saída = uso. O estoque é a soma das entradas menos as saídas.
create table if not exists insumo_movimentos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references barbearias(id) on delete cascade,
  insumo_id uuid not null references insumos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'saida')),
  quantidade numeric(10,2) not null check (quantidade > 0),
  valor_total numeric(10,2) check (valor_total is null or valor_total >= 0),
  data date not null default current_date,
  motivo text not null default '',
  simulado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists insumo_movimentos_barbearia_data on insumo_movimentos (barbearia_id, data);
create index if not exists insumo_movimentos_insumo on insumo_movimentos (insumo_id);

alter table servicos_precos enable row level security;
alter table despesas enable row level security;
alter table insumos enable row level security;
alter table insumo_movimentos enable row level security;
