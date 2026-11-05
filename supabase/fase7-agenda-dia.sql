-- Fase 7: agenda do dia confirmada pelo barbeiro. Rodar no SQL Editor do Supabase depois da fase 2.
-- Cada dia só aparece para os clientes depois que o barbeiro confirma a agenda (confirmada_em preenchido).
-- Como nas outras tabelas, o RLS fica ligado sem políticas: só o servidor (chave service_role) lê e escreve.

create table if not exists agenda_dia (
  id uuid primary key default gen_random_uuid(),
  profissional_id uuid not null references profissionais(id) on delete cascade,
  dia date not null,
  inicio time not null,
  fim time not null,
  almoco_inicio time,
  almoco_fim time,
  confirmada_em timestamptz,
  atualizada_em timestamptz not null default now(),
  unique (profissional_id, dia),
  check (fim > inicio),
  check ((almoco_inicio is null and almoco_fim is null) or (almoco_fim > almoco_inicio))
);

alter table agenda_dia enable row level security;
