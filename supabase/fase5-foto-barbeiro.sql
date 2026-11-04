-- Fase 5: foto do barbeiro, mostrada no site para o cliente escolher quem vai atendê-lo.
-- Rodar no SQL Editor do Supabase. Aditivo. A foto fica no bucket público "midia".
alter table profissionais add column if not exists foto_url text
  check (foto_url is null or char_length(foto_url) <= 500);
