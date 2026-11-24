-- Fase 35: aba Caixa (pedido do Manolo, Dom Manolo, 24/11). O caixa do dia sai do Financeiro e ganha uma aba
-- própria no painel do dono. Três coisas novas, para tudo aparecer certo no Financeiro:
--   1. cada retirada diz para onde foi o dinheiro (categoria):
--        despesa  = pagou um gasto com o dinheiro da gaveta (entra como gasto e sai do lucro)
--        vale     = adiantou dinheiro a um barbeiro (aparece ao lado da comissão dele; não sai do lucro de novo)
--        dono     = o dono tirou para ele (aparece no Financeiro, mas não é gasto da barbearia)
--        guardar  = levou para o cofre ou depositou no banco (só sai da gaveta)
--   2. o dia da retirada fica gravado nela (o Financeiro soma por período sem abrir cada caixa);
--   3. ao fechar, o dono diz quanto fica na gaveta de troco para o próximo dia (fica_troco).
-- Aditivo: só colunas novas. Retiradas antigas sem categoria contam como "guardar".

alter table public.caixa_movimentos
  add column if not exists categoria text check (categoria is null or categoria in ('despesa', 'vale', 'dono', 'guardar'));
alter table public.caixa_movimentos
  add column if not exists profissional_id uuid references public.profissionais(id) on delete set null;
alter table public.caixa_movimentos add column if not exists dia date;
update public.caixa_movimentos m set dia = c.dia from public.caixas c where m.caixa_id = c.id and m.dia is null;
create index if not exists caixa_movimentos_dia on public.caixa_movimentos (barbearia_id, dia);

alter table public.caixas
  add column if not exists fica_troco numeric(10,2) check (fica_troco is null or fica_troco >= 0);
