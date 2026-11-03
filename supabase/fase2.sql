-- Fase 2: agendamento. Rodar no SQL Editor do Supabase depois do schema.sql da fase 1.
-- Como nas outras tabelas, o RLS fica ligado sem políticas: só o servidor (chave service_role) lê e escreve.

-- Pedidos passam a ligar à barbearia e ao profissional por id (o slug continua para o link do site).
alter table pedidos add column if not exists barbearia_id uuid references barbearias(id) on delete cascade;
alter table pedidos add column if not exists profissional_id uuid references profissionais(id) on delete set null;
alter table pedidos add column if not exists horario_fim text;
alter table pedidos add column if not exists duracao_min integer check (duracao_min between 5 and 240);
create index if not exists pedidos_profissional_dia on pedidos (profissional_id, dia);

-- Dias e faixas de trabalho de cada profissional (ex.: seg, 09:00 às 18:00).
create table if not exists disponibilidade (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references profissionais(id) on delete cascade,
  dia_semana integer not null check (dia_semana between 0 and 6),
  inicio time not null,
  fim time not null,
  check (fim > inicio)
);
create index if not exists disponibilidade_profissional on disponibilidade (profissional_id, dia_semana);

-- Bloqueios: intervalos recorrentes (almoço, folga semanal) ou pontuais (uma data só).
create table if not exists bloqueios (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references profissionais(id) on delete cascade,
  tipo text not null check (tipo in ('recorrente', 'pontual')),
  dia_semana integer check (dia_semana between 0 and 6),
  data date,
  inicio time not null,
  fim time not null,
  motivo text not null default '',
  check (fim > inicio),
  check ((tipo = 'recorrente' and dia_semana is not null) or (tipo = 'pontual' and data is not null))
);
create index if not exists bloqueios_profissional on bloqueios (profissional_id);

-- Inscrições de notificação push (Web Push) dos perfis do painel.
create table if not exists push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  criado_em timestamptz not null default now()
);

alter table disponibilidade enable row level security;
alter table bloqueios enable row level security;
alter table push_inscricoes enable row level security;
