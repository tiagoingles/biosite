-- Fase 29: ritmo de retorno a partir do histórico do aplicativo anterior. Só acréscimos.
--
-- visitas_externas: atendimentos feitos (status realizado) no app anterior; ciclo_externo: intervalo típico entre
-- eles, em dias (mediana; nulo com menos de 2 visitas). A carteira de clientes usa o ciclo enquanto o cliente
-- tem poucas visitas no barbeirotop, em vez de supor 30 dias. recalcular_ritmo_externo(barbearia) refaz o resumo
-- a partir de atendimentos_externos (a importação chama a cada parte do histórico) e acerta a última visita.

alter table public.clientes add column if not exists visitas_externas integer check (visitas_externas is null or visitas_externas >= 0);
alter table public.clientes add column if not exists ciclo_externo integer check (ciclo_externo is null or ciclo_externo > 0);

create or replace function public.recalcular_ritmo_externo(p_barbearia_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  with d as (
    select distinct cliente_id, dia from public.atendimentos_externos
    where barbearia_id = p_barbearia_id and cliente_id is not null and status = 'realizado'
  ), v as (
    select cliente_id, dia, dia - lag(dia) over (partition by cliente_id order by dia) as intervalo from d
  ), r as (
    select cliente_id, count(*)::int as visitas, max(dia) as ultima,
      round(percentile_cont(0.5) within group (order by intervalo) filter (where intervalo > 0))::int as ciclo
    from v group by cliente_id
  ), u as (
    update public.clientes c
      set visitas_externas = r.visitas, ciclo_externo = r.ciclo, ultima_visita_externa = greatest(c.ultima_visita_externa, r.ultima)
    from r
    where c.id = r.cliente_id and c.barbearia_id = p_barbearia_id
      and (c.visitas_externas is distinct from r.visitas or c.ciclo_externo is distinct from r.ciclo
           or c.ultima_visita_externa is distinct from greatest(c.ultima_visita_externa, r.ultima))
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.recalcular_ritmo_externo(uuid) from public, anon, authenticated;
grant execute on function public.recalcular_ritmo_externo(uuid) to service_role;
