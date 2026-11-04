-- Fechamento do atendimento: o barbeiro marca o pedido como realizado ou não realizado.
-- Se não foi realizado, informa o motivo (reagendado ou cliente não apareceu).
alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('pendente', 'confirmado', 'recusado', 'cancelado', 'avulso', 'realizado', 'nao_realizado'));

alter table pedidos add column if not exists motivo text
  check (motivo in ('reagendado', 'cliente_nao_apareceu'));
