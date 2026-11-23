-- Fase 31: forma de pagamento (dinheiro, Pix, débito, crédito) no atendimento realizado e na venda de produto.
-- O Financeiro mostra quanto entrou em cada forma (base do caixa do dia). Pedido do Manolo (Dom Manolo, 19/11).
-- Aditivo: uma coluna em cada tabela, vazia nos registros antigos, e a função de venda passa a gravar a forma
-- (mesma assinatura; quem não manda a forma continua funcionando).

alter table public.pedidos add column if not exists forma_pagamento text
  check (forma_pagamento is null or forma_pagamento in ('dinheiro', 'pix', 'debito', 'credito'));
alter table public.produto_movimentos add column if not exists forma_pagamento text
  check (forma_pagamento is null or forma_pagamento in ('dinheiro', 'pix', 'debito', 'credito'));

-- Igual à da fase 19, mais a forma de pagamento da venda (p.forma_pagamento, opcional)
create or replace function public.produto_movimentar(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_barb uuid := (p->>'barbearia_id')::uuid;
  v_prod uuid := (p->>'produto_id')::uuid;
  v_tipo text := p->>'tipo';
  v_qtd int := (p->>'quantidade')::int;
  v_custo numeric := nullif(p->>'custo_unit', '')::numeric;
  v_prof uuid := nullif(p->>'profissional_id', '')::uuid;
  v_forma text := nullif(p->>'forma_pagamento', '');
  r record;
  v_delta int;
  v_novo int;
begin
  if v_tipo not in ('entrada', 'venda', 'ajuste') or v_qtd is null or v_qtd = 0 or abs(v_qtd) > 100000 then
    raise exception 'movimento invalido' using errcode = '22023';
  end if;
  select id, estoque, estoque_minimo, preco, custo into r from produtos where id = v_prod and barbearia_id = v_barb for update;
  if not found then
    return jsonb_build_object('erro', 'produto');
  end if;
  v_delta := case v_tipo when 'entrada' then abs(v_qtd) when 'venda' then -abs(v_qtd) else v_qtd end;
  v_novo := r.estoque + v_delta;
  if v_tipo = 'entrada' and v_custo is not null then
    update produtos set custo = v_custo where id = v_prod;
  end if;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, forma_pagamento)
  values (v_barb, v_prod, v_tipo, v_delta,
          case when v_tipo = 'venda' then r.preco end,
          case when v_tipo = 'entrada' then coalesce(v_custo, r.custo) when v_tipo = 'venda' then r.custo end,
          v_prof,
          case when v_tipo = 'venda' then v_forma end);
  update produtos set estoque = v_novo where id = v_prod;
  return jsonb_build_object('estoque', v_novo, 'minimo', r.estoque_minimo,
                            'cruzou', r.estoque > r.estoque_minimo and v_novo <= r.estoque_minimo);
end;
$$;
revoke all on function public.produto_movimentar(jsonb) from public, anon, authenticated;
grant execute on function public.produto_movimentar(jsonb) to service_role;
