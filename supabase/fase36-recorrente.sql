-- Fase 36: agendamento recorrente (pedido do Manolo, Dom Manolo, 24/11). Só o dono marca o mesmo cliente
-- toda semana, a cada 15 dias, a cada 3 ou a cada 4 semanas (sempre no mesmo dia da semana), até uma data.
-- Cada data vira um atendimento comum (lembrete, confirmação e financeiro iguais aos outros), ligado à série:
-- ao remarcar ou cancelar, o painel pergunta "só este" ou "este e os próximos".
-- Aditivo: uma tabela nova e uma coluna nova em pedidos. RLS ligado sem políticas: só o servidor lê e escreve.

create table if not exists public.pedido_series (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  cada_dias int not null check (cada_dias in (7, 14, 21, 28)),
  ate date not null,
  criado_em timestamptz not null default now()
);
alter table public.pedido_series enable row level security;

alter table public.pedidos add column if not exists serie_id uuid references public.pedido_series(id) on delete set null;
create index if not exists pedidos_serie on public.pedidos (serie_id) where serie_id is not null;
