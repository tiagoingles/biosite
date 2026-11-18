-- Fase 24: aceite do cliente quando a barbearia muda o horário. Quando o horário muda com aviso (celular ou
-- WhatsApp), o pedido guarda quando mudou e o horário de antes; o cliente responde pelo link "Aceito o novo
-- horário" / "Não posso nesse horário" (cliente_resposta, da fase 23). Aditivo: três colunas novas.
alter table public.pedidos add column if not exists remarcado_em timestamptz;
alter table public.pedidos add column if not exists dia_anterior date;
alter table public.pedidos add column if not exists horario_anterior text check (horario_anterior is null or horario_anterior ~ '^\d{2}:\d{2}$');
