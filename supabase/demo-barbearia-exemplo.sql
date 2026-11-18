-- Barbearia Exemplo: a vitrine da página de vendas (barbeirotop.com.br/barbearia-exemplo e o painel em
-- /painel-dono?demo=dono). Aberta para qualquer pessoa, sem login e só para olhar: o servidor recusa tudo o que não
-- é leitura e o site não grava agendamento (barbearias.demonstracao = 'vitrine', fase 25).
-- Tudo o que o Bio Site faz, com dados de exemplo: equipe com comissão, preços, produtos com estoque (um acabando
-- e um zerado), insumos, gastos fixos, clube com assinantes, clientes, fichas de prótese e 30 dias de atendimentos.
-- Os telefones usam o DDD 20, que não existe no Brasil: nenhuma pessoa de verdade recebe mensagem.
-- A agenda dos próximos dias e os atendimentos de hoje e de amanhã vêm de renovar_demonstracoes() (fase 25),
-- que roda no fim deste script e depois todo dia.
-- Só acrescenta: recusa rodar se a barbearia já existir.
do $$
declare
  v_b uuid; v_marcos uuid; v_felipe uuid; v_gustavo uuid; v_plano1 uuid; v_plano2 uuid; v_ficha uuid; v_prod uuid; v_ins uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  d date; i int; k int; s int; n int := 0; v_p uuid; v_nome text; v_com numeric; v_ini int; v_status text; v_cli int;
  servs text[] := array['Corte', 'Corte degradê', 'Barba', 'Corte + barba', 'Sobrancelha', 'Pigmentação'];
  precos numeric[] := array[40, 45, 30, 65, 15, 35];
  durs int[] := array[30, 40, 30, 60, 10, 30];
  clientes_nomes text[] := array['André Luiz', 'Caio Henrique', 'Daniel Souza', 'Eduardo Melo', 'Fábio Rocha', 'Guilherme Nunes', 'Heitor Campos', 'Igor Ramos', 'Júlio César', 'Kauã Ferreira', 'Leandro Paiva', 'Murilo Teixeira', 'Nicolas Prado', 'Otávio Lins'];
  clientes_ids uuid[] := array[]::uuid[];
  v_id uuid;
  profs uuid[];
begin
  if exists (select 1 from barbearias where slug = 'barbearia-exemplo') then
    raise exception 'A Barbearia Exemplo já existe: nada foi feito.';
  end if;

  insert into barbearias (nome, slug, confirmacao_automatica, protese_ativa, sinal, pedir_confirmacao_min, demonstracao)
  values ('Barbearia Exemplo', 'barbearia-exemplo', false, true, '{}'::jsonb, 120, 'vitrine') returning id into v_b;

  -- Equipe (o dono também atende) com a comissão de cada um. O segundo é o barbeiro da demonstração.
  insert into profissionais (barbearia_id, nome, comissao_pct, criado_em) values (v_b, 'Marcos', 0, now() - interval '3 minutes') returning id into v_marcos;
  insert into profissionais (barbearia_id, nome, comissao_pct, criado_em) values (v_b, 'Felipe', 45, now() - interval '2 minutes') returning id into v_felipe;
  insert into profissionais (barbearia_id, nome, comissao_pct, criado_em) values (v_b, 'Gustavo', 40, now() - interval '1 minute') returning id into v_gustavo;
  profs := array[v_marcos, v_felipe, v_gustavo];

  -- Preços (os mesmos do site)
  insert into servicos_precos (barbearia_id, nome, preco) values
    (v_b, 'Corte', 40), (v_b, 'Corte degradê', 45), (v_b, 'Barba', 30), (v_b, 'Corte + barba', 65),
    (v_b, 'Sobrancelha', 15), (v_b, 'Pigmentação', 35), (v_b, 'Prótese capilar (aplicação)', 350), (v_b, 'Prótese capilar (manutenção)', 120);

  -- Gastos fixos e insumos
  insert into despesas (barbearia_id, descricao, categoria, valor) values
    (v_b, 'Aluguel do ponto', 'aluguel', 1600), (v_b, 'Energia e água', 'contas', 340), (v_b, 'Bio Site', 'software', 39.90);
  insert into insumos (barbearia_id, nome, unidade, estoque_minimo) values (v_b, 'Lâmina descartável', 'un', 50) returning id into v_ins;
  insert into insumo_movimentos (barbearia_id, insumo_id, tipo, quantidade, valor_total, data, motivo) values
    (v_b, v_ins, 'entrada', 300, 90, v_hoje - 25, 'Compra no atacado'), (v_b, v_ins, 'saida', 230, null, v_hoje - 2, 'Uso do mês');
  insert into insumos (barbearia_id, nome, unidade, estoque_minimo) values (v_b, 'Toalha descartável', 'pct', 3) returning id into v_ins;
  insert into insumo_movimentos (barbearia_id, insumo_id, tipo, quantidade, valor_total, data, motivo) values
    (v_b, v_ins, 'entrada', 10, 150, v_hoje - 20, 'Compra'), (v_b, v_ins, 'saida', 5, null, v_hoje - 1, 'Uso');

  -- Produtos à venda: preço de compra, de venda e estoque (o óleo está acabando e o balm zerou)
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Pomada modeladora 120 g', 18, 35, 12, 3) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia) values (v_b, v_prod, 'entrada', 20, 18, v_hoje - 28);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia)
    select v_b, v_prod, 'venda', -1, 35, 18, profs[1 + (g % 3)], v_hoje - (g * 3) from generate_series(1, 8) g;
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Óleo para barba 30 ml', 22, 45, 2, 3) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia) values (v_b, v_prod, 'entrada', 8, 22, v_hoje - 28);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia)
    select v_b, v_prod, 'venda', -1, 45, 22, profs[1 + (g % 3)], v_hoje - (g * 4) from generate_series(1, 6) g;
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Shampoo para barba 200 ml', 15, 30, 7, 2) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia) values (v_b, v_prod, 'entrada', 10, 15, v_hoje - 28);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia)
    select v_b, v_prod, 'venda', -1, 30, 15, profs[1 + (g % 3)], v_hoje - (g * 6) from generate_series(1, 3) g;
  insert into produtos (barbearia_id, nome, custo, preco, estoque, estoque_minimo) values (v_b, 'Balm pós-barba', 20, 40, 0, 2) returning id into v_prod;
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, custo_unit, dia) values (v_b, v_prod, 'entrada', 4, 20, v_hoje - 28);
  insert into produto_movimentos (barbearia_id, produto_id, tipo, quantidade, preco_unit, custo_unit, profissional_id, dia)
    select v_b, v_prod, 'venda', -1, 40, 20, profs[1 + (g % 3)], v_hoje - (g * 5) from generate_series(1, 4) g;

  -- Clube de assinatura: dois planos e quatro assinantes (um venceu, um vence logo, dois em dia)
  insert into clube_planos (barbearia_id, nome, descricao, preco, servicos, intervalo_dias, dias_semana, hora_limite, comissao_valor, ativo)
  values (v_b, 'Clube Corte', 'Corte toda semana, de segunda a sexta até as 18h.', 89.90, array['Corte', 'Corte degradê'], 7, array[1, 2, 3, 4, 5], '18:00', 15, true) returning id into v_plano1;
  insert into clube_planos (barbearia_id, nome, descricao, preco, servicos, intervalo_dias, dias_semana, hora_limite, comissao_valor, ativo)
  values (v_b, 'Clube Corte + Barba', 'Corte e barba toda semana.', 139.90, array['Corte + barba'], 7, array[1, 2, 3, 4, 5, 6], null, 25, true) returning id into v_plano2;
  insert into clube_assinantes (barbearia_id, plano_id, nome, whatsapp, status, pago_ate) values
    (v_b, v_plano1, 'Daniel Souza', '20988880003', 'ativo', v_hoje - 2),
    (v_b, v_plano2, 'Eduardo Melo', '20988880004', 'ativo', v_hoje + 2),
    (v_b, v_plano1, 'Igor Ramos', '20988880008', 'ativo', v_hoje + 18),
    (v_b, v_plano2, 'Leandro Paiva', '20988880011', 'ativo', v_hoje + 25);

  -- Clientes (dois fazem aniversário este mês; metade aceita novidades)
  for i in 1..14 loop
    insert into clientes (barbearia_id, nome, telefone, nascimento, origem, aceita_novidades, profissional_id)
    values (v_b, clientes_nomes[i], '209888800' || lpad(i::text, 2, '0'),
            case when i in (2, 9) then make_date(1988 + i, extract(month from v_hoje)::int, least(28, extract(day from v_hoje)::int + i)) else null end,
            case when i % 3 = 0 then 'painel' else 'site' end, i % 2 = 0, profs[1 + (i % 3)])
    returning id into v_id;
    clientes_ids := clientes_ids || v_id;
  end loop;

  -- Prótese capilar: três fichas (uma atrasada, uma vence logo, uma em dia) com o histórico
  insert into protese_clientes (barbearia_id, nome, telefone, profissional_id, modelo, aplicada_em, intervalo_dias, ultima_manutencao)
  values (v_b, 'Roberto Galvão', '20988880021', v_marcos, 'Full lace, cor 1B', v_hoje - 90, 21, v_hoje - 25) returning id into v_ficha;
  insert into protese_manutencoes (barbearia_id, protese_cliente_id, dia, tipo, profissional_id) values
    (v_b, v_ficha, v_hoje - 90, 'aplicacao', v_marcos), (v_b, v_ficha, v_hoje - 46, 'manutencao', v_marcos), (v_b, v_ficha, v_hoje - 25, 'manutencao', v_marcos);
  insert into protese_clientes (barbearia_id, nome, telefone, profissional_id, modelo, aplicada_em, intervalo_dias, ultima_manutencao)
  values (v_b, 'Sandro Viana', '20988880022', v_marcos, 'Base de tela fina', v_hoje - 40, 21, v_hoje - 19) returning id into v_ficha;
  insert into protese_manutencoes (barbearia_id, protese_cliente_id, dia, tipo, profissional_id) values
    (v_b, v_ficha, v_hoje - 40, 'aplicacao', v_marcos), (v_b, v_ficha, v_hoje - 19, 'manutencao', v_marcos);
  insert into protese_clientes (barbearia_id, nome, telefone, profissional_id, modelo, aplicada_em, intervalo_dias, ultima_manutencao)
  values (v_b, 'Túlio Barros', '20988880023', v_felipe, 'Poliuretano', v_hoje - 6, 21, v_hoje - 6) returning id into v_ficha;
  insert into protese_manutencoes (barbearia_id, protese_cliente_id, dia, tipo, profissional_id) values (v_b, v_ficha, v_hoje - 6, 'aplicacao', v_felipe);

  -- 30 dias de atendimentos para o Financeiro e a carteira (ligados aos clientes, para os retornos fazerem sentido)
  for i in 1..30 loop
    d := v_hoje - i;
    continue when extract(dow from d) = 0;
    foreach v_p in array profs loop
      select nome, comissao_pct into v_nome, v_com from profissionais where id = v_p;
      for k in 1..(3 + floor(random() * 4))::int loop
        s := 1 + floor(random() * 6)::int;
        v_ini := (8 + k) * 60 + case when k >= 4 then 60 else 0 end;
        v_status := case when random() < 0.06 then 'nao_realizado' else 'realizado' end;
        v_cli := 1 + floor(random() * 14)::int;
        n := n + 1;
        insert into pedidos (slug, codigo, servico, profissional, dia, horario, horario_fim, cliente, status, motivo, barbearia_id, profissional_id, duracao_min, valor, comissao_pct, simulado, origem, cliente_id)
        values ('barbearia-exemplo', 'E' || lpad(n::text, 5, '0'), servs[s], v_nome, d,
                lpad((v_ini / 60)::text, 2, '0') || ':' || lpad((v_ini % 60)::text, 2, '0'),
                lpad(((v_ini + durs[s]) / 60)::text, 2, '0') || ':' || lpad(((v_ini + durs[s]) % 60)::text, 2, '0'),
                clientes_nomes[v_cli], v_status, case when v_status = 'nao_realizado' then 'cliente_nao_apareceu' end,
                v_b, v_p, durs[s], precos[s], v_com, false, 'demo', clientes_ids[v_cli]);
      end loop;
    end loop;
  end loop;
end $$;

-- Agenda publicada e atendimentos de hoje e de amanhã (depois, todo dia pelo pg_cron)
select public.renovar_demonstracoes();
