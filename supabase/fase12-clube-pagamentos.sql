-- Fase 12: pagamentos do clube de assinatura. Cada "Recebi" grava quanto entrou e em que dia,
-- para a mensalidade aparecer no Financeiro. O último pagamento pode ser desfeito (toque errado).
-- Só acrescenta: tabela nova e duas funções; nada existente muda.
-- Aplicada como migração "fase12_clube_pagamentos".

create table if not exists public.clube_pagamentos (
  id uuid primary key default gen_random_uuid(),
  barbearia_id uuid not null references public.barbearias(id) on delete cascade,
  assinante_id uuid not null references public.clube_assinantes(id) on delete cascade,
  plano_id uuid references public.clube_planos(id) on delete set null,
  valor numeric(10, 2) not null check (valor >= 0 and valor < 10000),
  data date not null,
  pago_ate_antes date,
  pago_ate_depois date not null,
  criado_em timestamptz not null default now()
);
create index if not exists clube_pagamentos_barbearia_data on public.clube_pagamentos (barbearia_id, data);
create index if not exists clube_pagamentos_assinante on public.clube_pagamentos (assinante_id, criado_em desc);
create index if not exists clube_pagamentos_plano on public.clube_pagamentos (plano_id);

alter table public.clube_pagamentos enable row level security;
revoke all on public.clube_pagamentos from anon, authenticated;
grant select, insert, update, delete on public.clube_pagamentos to service_role;

-- Registra 1 mês pago: grava o pagamento (com o dia de hoje em Brasília) e soma 1 mês ao vencimento,
-- a partir do vencimento atual ou de hoje, se já venceu. A trava na linha do assinante impede que dois
-- toques ao mesmo tempo somem 2 meses com a mesma base.
create or replace function public.clube_registrar_pagamento(p_barbearia uuid, p_assinante uuid, p_valor numeric)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_valor numeric := round(p_valor, 2);
  v_novo date;
  v_id uuid;
  a record;
begin
  if v_valor is null or v_valor < 0 or v_valor >= 10000 then
    raise exception 'valor invalido' using errcode = '22023';
  end if;
  select s.pago_ate, s.plano_id into a
    from clube_assinantes s
   where s.id = p_assinante and s.barbearia_id = p_barbearia
   for update;
  if not found then
    return jsonb_build_object('erro', 'assinante');
  end if;
  v_novo := (greatest(coalesce(a.pago_ate, v_hoje), v_hoje) + interval '1 month')::date;
  insert into clube_pagamentos (barbearia_id, assinante_id, plano_id, valor, data, pago_ate_antes, pago_ate_depois)
  values (p_barbearia, p_assinante, a.plano_id, v_valor, v_hoje, a.pago_ate, v_novo)
  returning id into v_id;
  update clube_assinantes set pago_ate = v_novo, status = 'ativo', atualizado_em = now() where id = p_assinante;
  return jsonb_build_object('id', v_id, 'valor', v_valor, 'data', v_hoje, 'pago_ate', v_novo);
end;
$function$;

-- Desfaz o último pagamento do assinante (só se for o que o dono está vendo). O vencimento volta ao
-- que era, a não ser que tenha sido mudado à mão depois do pagamento; aí fica como está.
create or replace function public.clube_desfazer_pagamento(p_barbearia uuid, p_assinante uuid, p_pagamento uuid)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  a record;
  pg record;
begin
  select s.pago_ate into a
    from clube_assinantes s
   where s.id = p_assinante and s.barbearia_id = p_barbearia
   for update;
  if not found then
    return jsonb_build_object('erro', 'assinante');
  end if;
  select x.id, x.valor, x.pago_ate_antes, x.pago_ate_depois into pg
    from clube_pagamentos x
   where x.assinante_id = p_assinante and x.barbearia_id = p_barbearia
   order by x.criado_em desc, x.id desc
   limit 1;
  if not found or pg.id is distinct from p_pagamento then
    return jsonb_build_object('erro', 'ultimo');
  end if;
  delete from clube_pagamentos where id = pg.id;
  if a.pago_ate is not distinct from pg.pago_ate_depois then
    update clube_assinantes set pago_ate = pg.pago_ate_antes, atualizado_em = now() where id = p_assinante;
    return jsonb_build_object('ok', true, 'valor', pg.valor, 'pago_ate', pg.pago_ate_antes);
  end if;
  return jsonb_build_object('ok', true, 'valor', pg.valor, 'pago_ate', a.pago_ate, 'manteve', true);
end;
$function$;

revoke all on function public.clube_registrar_pagamento(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.clube_desfazer_pagamento(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.clube_registrar_pagamento(uuid, uuid, numeric) to service_role;
grant execute on function public.clube_desfazer_pagamento(uuid, uuid, uuid) to service_role;
