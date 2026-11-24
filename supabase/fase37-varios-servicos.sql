-- Fase 37: vários serviços de uma vez (pedido do Manolo, Dom Manolo, 24/11).
-- No encaixe, o dono marca vários serviços na mesma janela, cada um com o barbeiro, o horário e para quem é:
-- o próprio cliente, um filho ou filha, um parente ou outra pessoa. Cada serviço vira um atendimento, e os da
-- mesma marcação ficam ligados pelo grupo. O cliente da marcação continua sendo quem recebe os avisos.
-- No site, vários serviços do mesmo cliente viram um atendimento só (nomes juntos, tempo e preço somados):
-- não precisa de coluna nova.
-- Aditivo: três colunas novas em pedidos.

alter table public.pedidos add column if not exists grupo_id uuid;
alter table public.pedidos
  add column if not exists para_quem text check (para_quem is null or para_quem in ('filho', 'parente', 'outro'));
alter table public.pedidos
  add column if not exists para_nome text check (para_nome is null or char_length(para_nome) <= 60);
create index if not exists pedidos_grupo on public.pedidos (grupo_id) where grupo_id is not null;
