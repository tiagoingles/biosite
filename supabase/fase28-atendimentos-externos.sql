-- Fase 28: histórico de atendimentos do aplicativo anterior (Booksy). Só acréscimos.
--
-- Fica numa tabela própria, separada de pedidos: aparece na ficha do cliente como "no aplicativo anterior" e não
-- entra na agenda, no financeiro, nas comissões nem nos avisos. externo = "booksy:<id do atendimento>": a coleta
-- rodada de novo não duplica. Valor não vem do Booksy por atendimento, então fica vazio.

create table if not exists public.atendimentos_externos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  origem text not null default 'booksy' check (origem in ('booksy')),
  externo text not null check (char_length(externo) <= 60),
  dia date not null,
  horario text check (horario is null or horario ~ '^\d{2}:\d{2}$'),
  servico text check (servico is null or char_length(servico) <= 80),
  profissional text check (profissional is null or char_length(profissional) <= 80),
  profissional_id uuid references public.profissionais(id) on delete set null,
  status text not null check (status in ('realizado', 'faltou')),
  criado_em timestamptz not null default now(),
  unique (barbearia_id, externo)
);
alter table public.atendimentos_externos enable row level security;
create index if not exists atendimentos_externos_cliente on public.atendimentos_externos (cliente_id, dia desc) where cliente_id is not null;
create index if not exists atendimentos_externos_barbearia on public.atendimentos_externos (barbearia_id, dia);
