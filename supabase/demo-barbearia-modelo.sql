-- Barbearia Modelo: barbearia de demonstração para as vendas (barbeirotop.com.br/barbearia-modelo).
-- Tudo o que o Bio Site faz, com dados de exemplo: equipe com comissão, agenda publicada, preços, produtos com
-- estoque (um acabando e um zerado), insumos, gastos fixos, clube com assinantes, clientes, fichas de prótese
-- e 30 dias de atendimentos. Os telefones usam o DDD 20, que não existe no Brasil: nenhuma pessoa de verdade
-- recebe mensagem. O que é histórico fica com simulado = true (o admin zera pelo Financeiro).
-- Só acrescenta: recusa rodar se a barbearia já existir.
do $$
declare
  v_b uuid; v_carlos uuid; v_rafael uuid; v_lucas uuid; v_plano1 uuid; v_plano2 uuid; v_ficha uuid; v_prod uuid; v_ins uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  d date; i int; k int; s int; n int := 0; v_p uuid; v_nome text; v_com numeric; v_ini int; v_status text;
  servs text[] := array['Corte', 'Corte degradê', 'Barba', 'Corte + barba', 'Sobrancelha', 'Pigmentação'];
  precos numeric[] := array[40, 45, 30, 65, 15, 35];
  durs int[] := array[30, 40, 30, 60, 10, 30];
  clientes_nomes text[] := array['João Pedro', 'Marcos Vinícius', 'Felipe Andrade', 'Thiago Moura', 'Lucas Almeida', 'Bruno Henrique', 'Diego Santos', 'Rafael Lima', 'Gabriel Costa', 'Matheus Rocha', 'Vinícius Alves', 'Leonardo Dias'];
  profs uuid[];
begin
  if exists (select 1 from barbearias where slug = 'barbearia-modelo') then
    raise exception 'A Barbearia Modelo já existe: nada foi feito.';
  end if;

  insert into barbearias (nome, slug, confirmacao_automatica, protese_ativa, sinal)
  values ('Barbearia Modelo', 'barbearia-modelo', false, true, '{}'::jsonb) returning id into v_b;

  -- Equipe (o dono também atende) com a comissão de cada um
  insert into profissionais (barbearia_id, nome, comissao_pct) values (v_b, 'Carlos', 0) returning id into v_carlos;
  insert into profissionais (barbearia_id, nome, comissao_pct) values (v_b, 'Rafael', 45) returning id into v_rafael;
  insert into profissionais (barbearia_id, nome, comissao_pct) values (v_b, 'Lucas', 40) returning id into v_lucas;
  profs := array[v_carlos, v_rafael, v_lucas];

  -- Agenda publicada nos próximos 21 dias, de segunda a sábado
  for i in 0..20 loop
    d := v_hoje + i;
    continue when extract(dow from d) = 0;
    foreach v_p in array profs loop
      insert into agenda_dia (profissional_id, dia, inicio, fim, almoco_inicio, almoco_fim, confirmada_em)
      values (v_p, d, '09:00', (case when extract(dow from d) = 6 then '17:00' else '19:00' end)::time, '12:00', '13:00', now());
    end loop;
  end loop;

  -- Preços (os mesmos do site)
  insert into servicos_precos (barbearia_id, nome, preco) values
    (v_b, 'Corte', 40), (v_b, 'Corte degradê', 45), (v_b, 'Barba', 30), (v_b, 'Corte + barba', 65),
    (v_b, 'Sobrancelha', 15), (v_b, 'Pigmentação', 35), (v_b, 'Prótese capilar (aplicação)', 350), (v_b, 'Prótese capilar (manutenção)', 120);

  -- Gastos fixos e insumos (simulação)
  insert into despesas (barbearia_id, descricao, categoria, valor, simulado) values
    (v_b, 'Aluguel do ponto', 'aluguel', 1500, true), (v_b, 'Energia e água', 'contas', 320, true), (v_b, 'Bio Site', 'software', 39.90, true);
  insert into insumos (barbearia_id, nome, unidade, estoque_minimo, simulado) values (v_b, 'Lâmina descartável', 'un', 50, true) returning id into v_ins;
  insert into insumo_movimentos (barbearia_id, insumo_id, tipo, quantidade, valor_total, data, motivo, simulado) values
    (v_b, v_ins, 'entrada', 300, 90, v_hoje - 25, 'Compra no atacado', true), (v_b, v_ins, 'saida', 220, null, v_hoje - 2, 'Uso do mês', true);
  insert into insumos (barbearia_id, nome, unidade, estoque_minimo, simulado) values (v_b, 'Toalha descartável', 'pct', 3, true) returning id into v_ins;
  insert into insumo_movimentos (barbearia_id, insumo_id, tipo, quantidade, valor_total, data, motivo, simulado) values
    (v_b, v_ins, 'entrada', 10, 150, v_hoje - 20, 'Compra', true), (v_b, v_ins, 'saida', 6, null, v_hoje - 1, 'Uso', true);

  -- Produtos à venda: preço de compra, de venda e estoque (o óleo está acabando e o balm zerou)
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Pomada modeladora 120 g', 18, 35, 12, 3) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia, simulado) values (v_b, v_prod, 'entrada', 20, 18, v_hoje - 28, true);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia, simulado)
    select v_b, v_prod, 'venda', -1, 35, 18, profs[1 + (g % 3)], v_hoje - (g * 3), true from generate_series(1, 8) g;
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Óleo para barba 30 ml', 22, 45, 2, 3) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia, simulado) values (v_b, v_prod, 'entrada', 8, 22, v_hoje - 28, true);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia, simulado)
    select v_b, v_prod, 'venda', -1, 45, 22, profs[1 + (g % 3)], v_hoje - (g * 4), true from generate_series(1, 6) g;
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Shampoo para barba 200 ml', 15, 30, 7, 2) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia, simulado) values (v_b, v_prod, 'entrada', 10, 15, v_hoje - 28, true);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia, simulado)
    select v_b, v_prod, 'venda', -1, 30, 15, profs[1 + (g % 3)], v_hoje - (g * 6), true from generate_series(1, 3) g;
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Balm pós-barba', 20, 40, 0, 2) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia, simulado) values (v_b, v_prod, 'entrada', 4, 20, v_hoje - 28, true);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia, simulado)
    select v_b, v_prod, 'venda', -1, 40, 20, profs[1 + (g % 3)], v_hoje - (g * 5), true from generate_series(1, 4) g;

  -- Clube de assinatura: dois planos e três assinantes (um venceu, um vence logo, um em dia)
  insert into clube_planos (barbearia_id, nome, descricao, preco, servicos, intervalo_dias, dias_semana, hora_limite, comissao_valor, ativo)
  values (v_b, 'Clube Corte', 'Corte toda semana, de segunda a sexta até as 18h.', 89.90, array['Corte', 'Corte degradê'], 7, array[1, 2, 3, 4, 5], '18:00', 15, true) returning id into v_plano1;
  insert into clube_planos (barbearia_id, nome, descricao, preco, servicos, intervalo_dias, dias_semana, hora_limite, comissao_valor, ativo)
  values (v_b, 'Clube Corte + Barba', 'Corte e barba toda semana.', 139.90, array['Corte + barba'], 7, array[1, 2, 3, 4, 5, 6], null, 25, true) returning id into v_plano2;
  insert into clube_assinantes (barbearia_id, plano_id, nome, whatsapp, status, pago_ate) values
    (v_b, v_plano1, 'Thiago Moura', '20999990004', 'ativo', v_hoje - 2),
    (v_b, v_plano2, 'Felipe Andrade', '20999990003', 'ativo', v_hoje + 2),
    (v_b, v_plano1, 'Gabriel Costa', '20999990009', 'ativo', v_hoje + 20);

  -- Clientes (dois fazem aniversário este mês)
  for i in 1..12 loop
    insert into clientes (barbearia_id, nome, telefone, nascimento, origem, aceita_novidades, profissional_id)
    values (v_b, clientes_nomes[i], '209999900' || lpad(i::text, 2, '0'),
            case when i in (2, 7) then make_date(1990 + i, extract(month from v_hoje)::int, least(28, extract(day from v_hoje)::int + i)) else null end,
            case when i % 3 = 0 then 'painel' else 'site' end, i % 2 = 0, profs[1 + (i % 3)]);
  end loop;

  -- Prótese capilar: três fichas (uma atrasada, uma vence logo, uma em dia) com o histórico
  insert into protese_clientes (barbearia_id, nome, telefone, profissional_id, modelo, aplicada_em, intervalo_dias, ultima_manutencao)
  values (v_b, 'Ricardo Nunes', '20999990013', v_carlos, 'Full lace, cor 1B', v_hoje - 90, 21, v_hoje - 25) returning id into v_ficha;
  insert into protese_manutencoes (barbearia_id, protese_cliente_id, dia, tipo, profissional_id) values
    (v_b, v_ficha, v_hoje - 90, 'aplicacao', v_carlos), (v_b, v_ficha, v_hoje - 46, 'manutencao', v_carlos), (v_b, v_ficha, v_hoje - 25, 'manutencao', v_carlos);
  insert into protese_clientes (barbearia_id, nome, telefone, profissional_id, modelo, aplicada_em, intervalo_dias, ultima_manutencao)
  values (v_b, 'Eduardo Pires', '20999990014', v_carlos, 'Base de tela fina', v_hoje - 40, 21, v_hoje - 19) returning id into v_ficha;
  insert into protese_manutencoes (barbearia_id, protese_cliente_id, dia, tipo, profissional_id) values
    (v_b, v_ficha, v_hoje - 40, 'aplicacao', v_carlos), (v_b, v_ficha, v_hoje - 19, 'manutencao', v_carlos);
  insert into protese_clientes (barbearia_id, nome, telefone, profissional_id, modelo, aplicada_em, intervalo_dias, ultima_manutencao)
  values (v_b, 'Sérgio Lopes', '20999990015', v_rafael, 'Poliuretano', v_hoje - 6, 21, v_hoje - 6) returning id into v_ficha;
  insert into protese_manutencoes (barbearia_id, protese_cliente_id, dia, tipo, profissional_id) values (v_b, v_ficha, v_hoje - 6, 'aplicacao', v_rafael);

  -- 30 dias de atendimentos para o Financeiro e a carteira (simulação)
  for i in 1..30 loop
    d := v_hoje - i;
    continue when extract(dow from d) = 0;
    foreach v_p in array profs loop
      select nome, comissao_pct into v_nome, v_com from profissionais where id = v_p;
      for k in 1..(3 + floor(random() * 4))::int loop
        s := 1 + floor(random() * 6)::int;
        v_ini := (8 + k) * 60 + case when k >= 4 then 60 else 0 end;
        v_status := case when random() < 0.06 then 'nao_realizado' else 'realizado' end;
        n := n + 1;
        insert into pedidos (slug, codigo, servico, profissional, dia, horario, horario_fim, cliente, status, motivo, barbearia_id, profissional_id, duracao_min, valor, comissao_pct, simulado)
        values ('barbearia-modelo', 'M' || lpad(n::text, 5, '0'), servs[s], v_nome, d,
                lpad((v_ini / 60)::text, 2, '0') || ':' || lpad((v_ini % 60)::text, 2, '0'),
                lpad(((v_ini + durs[s]) / 60)::text, 2, '0') || ':' || lpad(((v_ini + durs[s]) % 60)::text, 2, '0'),
                clientes_nomes[1 + floor(random() * 12)::int], v_status, case when v_status = 'nao_realizado' then 'cliente_nao_apareceu' end,
                v_b, v_p, durs[s], precos[s], v_com, true);
      end loop;
    end loop;
  end loop;

  -- Próximos dois dias: atendimentos de verdade (ocupam a agenda do site), alguns para confirmar
  insert into pedidos (slug, codigo, servico, profissional, dia, horario, horario_fim, cliente, status, barbearia_id, profissional_id, duracao_min, valor, origem) values
    ('barbearia-modelo', 'H0001', 'Corte degradê', 'Rafael', v_hoje + 1, '14:00', '14:40', 'Diego Santos', 'confirmado', v_b, v_rafael, 40, 45, 'demo'),
    ('barbearia-modelo', 'H0002', 'Corte + barba', 'Carlos', v_hoje + 1, '15:00', '16:00', 'Matheus Rocha', 'confirmado', v_b, v_carlos, 60, 65, 'demo'),
    ('barbearia-modelo', 'H0003', 'Barba', 'Lucas', v_hoje + 1, '16:30', '17:00', 'Vinícius Alves', 'pendente', v_b, v_lucas, 30, 30, 'demo'),
    ('barbearia-modelo', 'H0004', 'Prótese capilar (manutenção)', 'Carlos', v_hoje + 2, '10:00', '11:00', 'Ricardo Nunes', 'confirmado', v_b, v_carlos, 60, 120, 'demo'),
    ('barbearia-modelo', 'H0005', 'Corte', 'Rafael', v_hoje + 2, '11:00', '11:30', 'João Pedro', 'pendente', v_b, v_rafael, 30, 40, 'demo'),
    ('barbearia-modelo', 'H0006', 'Pigmentação', 'Lucas', v_hoje + 2, '15:00', '15:30', 'Leonardo Dias', 'confirmado', v_b, v_lucas, 30, 35, 'demo');
end $$;
