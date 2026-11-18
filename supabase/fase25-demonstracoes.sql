-- Fase 25: as duas barbearias de demonstração e o WhatsApp da barbearia no banco. Só acréscimos.
--
-- barbearias.whatsapp: o WhatsApp que recebe os pedidos do site (DDD + número, sem o 55). Vazio: vale o número
--   publicado no site. O dono troca em Mais > Agendamentos sem republicar; na Barbearia Modelo, o Tiago põe o
--   WhatsApp do dono que está vendo a apresentação.
-- barbearias.demonstracao: 'apresentacao' (Barbearia Modelo, usada nas reuniões de venda) ou 'vitrine'
--   (Barbearia Exemplo, aberta na página de vendas sem login e só para olhar; o site não grava agendamentos).
-- renovar_demonstracoes(): roda todo dia e mantém as duas com cara de barbearia funcionando: publica a agenda dos
--   próximos 21 dias, encerra os atendimentos de exemplo que já passaram, cria os de hoje e de amanhã e anda as
--   datas do clube, da prótese e dos aniversários junto com o calendário. Só mexe em barbearias de demonstração.

alter table public.barbearias add column if not exists whatsapp text check (whatsapp is null or whatsapp ~ '^[1-9][0-9]\d{8,9}$');
alter table public.barbearias add column if not exists demonstracao text check (demonstracao is null or demonstracao in ('apresentacao', 'vitrine'));
update public.barbearias set demonstracao = 'apresentacao' where slug = 'barbearia-modelo' and demonstracao is null;

-- Último dia em que cada demonstração foi renovada (para andar as datas pelo número certo de dias)
create table if not exists public.demonstracoes_renovacao (
  barbearia_id uuid primary key references public.barbearias(id) on delete cascade,
  dia date not null
);
alter table public.demonstracoes_renovacao enable row level security;

create or replace function public.renovar_demonstracoes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_b record; v_p record; v_c record;
  v_ultimo date; v_delta int; d date; k int; n int; v_criados int := 0;
  v_ini int; v_dur int; s int; v_hh text; v_fim text; v_status text; v_cod text;
  -- Serviços de exemplo (nome, preço, duração): os mesmos das duas demonstrações
  servs text[] := array['Corte', 'Corte degradê', 'Barba', 'Corte + barba', 'Sobrancelha', 'Pigmentação'];
  precos numeric[] := array[40, 45, 30, 65, 15, 35];
  durs int[] := array[30, 40, 30, 60, 10, 30];
  -- Horários de início possíveis (minutos desde 0h), fora do almoço das 12h às 13h
  inicios int[] := array[540, 600, 660, 780, 840, 900, 960, 1020, 1080];
  v_idx int; v_prof int := 0;
begin
  for v_b in select id, slug from barbearias where demonstracao is not null loop
    -- 1. Datas que andam com o calendário (clube, prótese, aniversários)
    select dia into v_ultimo from demonstracoes_renovacao where barbearia_id = v_b.id;
    v_delta := coalesce(v_hoje - v_ultimo, 0);
    if v_delta > 0 then
      update clube_assinantes set pago_ate = pago_ate + v_delta,
        lembrete_pago_ate = case when lembrete_pago_ate is null then null else lembrete_pago_ate + v_delta end,
        lembrete_em = case when lembrete_em is null then null else lembrete_em + make_interval(days => v_delta) end
        where barbearia_id = v_b.id and pago_ate is not null;
      update protese_clientes set aplicada_em = aplicada_em + v_delta, ultima_manutencao = ultima_manutencao + v_delta,
        lembrete_em = case when lembrete_em is null then null else lembrete_em + make_interval(days => v_delta) end
        where barbearia_id = v_b.id;
      update protese_manutencoes set dia = dia + v_delta where barbearia_id = v_b.id and pedido_id is null;
      update clientes set nascimento = nascimento + v_delta where barbearia_id = v_b.id and nascimento is not null;
    end if;
    insert into demonstracoes_renovacao (barbearia_id, dia) values (v_b.id, v_hoje)
      on conflict (barbearia_id) do update set dia = excluded.dia;

    -- 2. Atendimentos de exemplo que já passaram: confirmados viram realizados (com a comissão do barbeiro);
    --    pendentes que ninguém confirmou ficam recusados
    update pedidos p set status = 'realizado', comissao_pct = coalesce(p.comissao_pct, pr.comissao_pct)
      from profissionais pr
      where p.barbearia_id = v_b.id and p.origem = 'demo' and p.dia < v_hoje and p.status in ('confirmado', 'avulso') and pr.id = p.profissional_id;
    update pedidos set status = 'recusado' where barbearia_id = v_b.id and origem = 'demo' and dia < v_hoje and status = 'pendente';

    v_prof := 0;
    for v_p in select id, nome from profissionais where barbearia_id = v_b.id and ativo order by criado_em loop
      v_prof := v_prof + 1;
      -- 3. Agenda publicada nos próximos 21 dias, de segunda a sábado (não mexe no que já existe)
      insert into agenda_dia (profissional_id, dia, inicio, fim, almoco_inicio, almoco_fim, confirmada_em)
        select v_p.id, g::date, '09:00', (case when extract(dow from g) = 6 then '17:00' else '19:00' end)::time, '12:00', '13:00', now()
        from generate_series(v_hoje, v_hoje + 20, interval '1 day') g
        where extract(dow from g) <> 0
        on conflict (profissional_id, dia) do nothing;

      -- 4. Atendimentos de exemplo de hoje e de amanhã (só se o dia ainda não tem os dele)
      for k in 0..1 loop
        d := v_hoje + k;
        continue when extract(dow from d) = 0;
        continue when exists (select 1 from pedidos where barbearia_id = v_b.id and profissional_id = v_p.id and dia = d and origem = 'demo');
        n := 0;
        for v_idx in 1..array_length(inicios, 1) loop
          -- Uns 45% dos horários ocupados: sobra espaço para agendar ao vivo na apresentação
          continue when random() > 0.45;
          v_ini := inicios[v_idx];
          continue when extract(dow from d) = 6 and v_ini >= 1020;
          s := 1 + floor(random() * 6)::int;
          v_dur := durs[s];
          v_hh := lpad((v_ini / 60)::text, 2, '0') || ':' || lpad((v_ini % 60)::text, 2, '0');
          v_fim := lpad(((v_ini + v_dur) / 60)::text, 2, '0') || ':' || lpad(((v_ini + v_dur) % 60)::text, 2, '0');
          -- Não encosta em nenhum atendimento que já está na agenda (inclusive os marcados ao vivo)
          continue when exists (
            select 1 from pedidos x where x.profissional_id = v_p.id and x.dia = d
              and x.status in ('pendente', 'confirmado', 'avulso', 'realizado')
              and x.horario < v_fim and coalesce(x.horario_fim, x.horario) > v_hh);
          select id, nome into v_c from clientes where barbearia_id = v_b.id order by random() limit 1;
          v_status := case when k = 1 and random() < 0.3 then 'pendente' else 'confirmado' end;
          n := n + 1;
          v_cod := 'D' || to_char(d, 'YYMMDD') || chr(64 + v_prof) || chr(64 + n);
          insert into pedidos (slug, codigo, servico, profissional, dia, horario, horario_fim, cliente, status, barbearia_id, profissional_id, duracao_min, valor, origem, cliente_id, simulado)
          values (v_b.slug, v_cod, servs[s], v_p.nome, d, v_hh, v_fim, coalesce(v_c.nome, 'Cliente'), v_status, v_b.id, v_p.id, v_dur, precos[s], 'demo', v_c.id, false)
          on conflict (slug, codigo) do nothing;
          v_criados := v_criados + 1;
        end loop;
      end loop;
    end loop;
  end loop;
  return v_criados;
end $$;

revoke all on function public.renovar_demonstracoes() from public, anon, authenticated;

-- Todo dia às 3h05 de Brasília (6h05 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'biosite-renovar-demonstracoes';
select cron.schedule('biosite-renovar-demonstracoes', '5 6 * * *', $cron$select public.renovar_demonstracoes()$cron$);
