-- Fase 15: WhatsApp automático (plano Premium), em modo de teste.
-- Cada barbearia escolhe quais mensagens automáticas quer (lembrete de horário, obrigado e avaliação,
-- hora de voltar, reconquista, aniversário, vencimento do clube) e o texto de cada uma. Enquanto o
-- WhatsApp oficial da barbearia não estiver conectado (conta da Meta, fase 2), o painel só mostra a
-- prévia do que seria enviado; nada sai.
-- Só acrescenta: uma tabela nova; nada existente muda. Aplicada como migração "fase15_whatsapp_automacoes".

create table if not exists public.whatsapp_automacoes (
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  tipo text not null check (tipo in ('lembrete_vespera', 'lembrete_2h', 'pos_atendimento', 'retorno', 'reconquista', 'aniversario', 'clube_vencimento')),
  ativa boolean not null default true,
  -- Corpo da mensagem com as variáveis ({nome}, {dia}, {hora}...); o modelo da Meta aceita até 1.024 caracteres
  texto text not null check (char_length(texto) between 10 and 700),
  -- Ajustes da automação (oferta da reconquista e do aniversário, link de avaliação no Google)
  config jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (barbearia_id, tipo)
);

alter table public.whatsapp_automacoes enable row level security;
revoke all on public.whatsapp_automacoes from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_automacoes to service_role;
