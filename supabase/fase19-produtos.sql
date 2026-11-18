-- Fase 19: produtos vendidos na barbearia (pomada, shampoo, óleo...) com preço de compra e de venda,
-- estoque fácil (+1, -1 ou a quantidade) e alerta de estoque baixo. Cada venda grava o preço e o custo
-- do momento: o Financeiro mostra o bruto, o custo e o lucro, e um reajuste não muda o passado.
-- Aditivo: duas tabelas novas e uma função. RLS ligado sem políticas: só o servidor lê e escreve.

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 80),
  custo numeric(10,2) check (custo is null or custo >= 0),
  preco numeric(10,2) not null check (preco >= 0),
  estoque int not null default 0,
  estoque_minimo int not null default 0 check (estoque_minimo >= 0),
  foto text not null default '' check (char_length(foto) <= 400),
  ativo boolean not null default true,
  simulado boolean not null default false,
  criado_em timestamptz not null default now(),
  unique (barbearia_id, nome)
);
create index if not exists produtos_barbearia on public.produtos (barbearia_id);

-- entrada = compra/reposição (+), venda = saída vendida (-), ajuste = correção do estoque (+ ou -)
create table if not exists public.produto_movimentos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  produto_id uuid not null references public.produtos(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'venda', 'ajuste')),
  quantidade int not null check (quantidade <> 0),
  preco_unit numeric(10,2) check (preco_unit is null or preco_unit >= 0),
  custo_unit numeric(10,2) check (custo_unit is null or custo_unit >= 0),
  profissional_id uuid references public.profissionais(id) on delete set null,
  dia date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  simulado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists produto_movimentos_barbearia_dia on public.produto_movimentos (barbearia_id, dia);
create index if not exists produto_movimentos_produto on public.produto_movimentos (produto_id);

alter table public.produtos enable row level security;
alter table public.produto_movimentos enable row level security;

-- Movimenta o estoque de um produto de forma atômica (duas vendas ao mesmo tempo não se perdem).
-- p: { barbearia_id, produto_id, tipo, quantidade (sempre positiva), custo_unit?, profissional_id? }
-- Venda grava o preço e o custo do produto no momento. Entrada com custo novo atualiza o preço de compra.
-- Devolve { estoque, minimo, cruzou }: cruzou = o estoque acabou de chegar ao mínimo (hora de avisar o dono).
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
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id)
  values (v_barb, v_prod, v_tipo, v_delta,
          case when v_tipo = 'venda' then r.preco end,
          case when v_tipo = 'entrada' then coalesce(v_custo, r.custo) when v_tipo = 'venda' then r.custo end,
          v_prof);
  update produtos set estoque = v_novo where id = v_prod;
  return jsonb_build_object('estoque', v_novo, 'minimo', r.estoque_minimo,
                            'cruzou', r.estoque > r.estoque_minimo and v_novo <= r.estoque_minimo);
end;
$$;
revoke all on function public.produto_movimentar(jsonb) from public, anon, authenticated;
grant execute on function public.produto_movimentar(jsonb) to service_role;
