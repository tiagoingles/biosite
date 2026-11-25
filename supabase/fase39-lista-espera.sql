-- Fase 39: lista de espera (pedido do Manolo, Dom Manolo, 24/11). Quem não acha horário no site entra na lista
-- dizendo o dia e de que horas até que horas pode (o dono também coloca quem pede pelo telefone). A ordem de
-- chegada é a prioridade. Quando um horário vaga (cancelamento ou desistência), o painel mostra quem da lista
-- cabe nele, na ordem, com o WhatsApp pronto para chamar.
-- status: esperando -> contatado (o dono chamou) -> marcado (virou horário) ou saiu (desistiu ou foi tirado).
-- Aditivo: uma tabela nova. RLS ligado sem políticas: só o servidor lê e escreve.

create table if not exists public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  cliente_id uuid references public.clientes(id) on delete set null,
  nome text not null check (char_length(nome) between 2 and 80),
  telefone text not null default '' check (char_length(telefone) <= 13),
  servico text not null check (char_length(servico) between 1 and 200),
  duracao_min int not null default 30 check (duracao_min between 5 and 240),
  profissional_id uuid references public.profissionais(id) on delete set null,
  dia date not null,
  de text not null check (de ~ '^\d{2}:\d{2}$'),
  ate text not null check (ate ~ '^\d{2}:\d{2}$'),
  observacao text not null default '' check (char_length(observacao) <= 200),
  status text not null default 'esperando' check (status in ('esperando', 'contatado', 'marcado', 'saiu')),
  contatado_em timestamptz,
  origem text,
  pelo_site boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists lista_espera_dia on public.lista_espera (barbearia_id, dia, criado_em);
alter table public.lista_espera enable row level security;
