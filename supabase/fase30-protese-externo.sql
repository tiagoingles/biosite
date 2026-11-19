-- Fase 30: manutenções de prótese vindas do aplicativo anterior. Só acréscimos.
--
-- externo = "booksy:<id do atendimento>": a ficha de prótese criada pela migração recebe as manutenções do
-- histórico do Booksy, e rodar de novo não duplica. Manutenção registrada no painel fica com externo nulo
-- (nulos não se repetem no índice único).

alter table public.protese_manutencoes add column if not exists externo text check (externo is null or char_length(externo) <= 60);
create unique index if not exists protese_manutencoes_externo on public.protese_manutencoes (barbearia_id, externo);
