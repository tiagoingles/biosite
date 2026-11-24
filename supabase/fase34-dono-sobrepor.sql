-- Fase 34: o dono pode marcar dois clientes no mesmo horário do mesmo barbeiro (pedido do Manolo, 23/11:
-- um cliente corta com o Manolo enquanto ele começa a limpeza da prótese de outro). Só o servidor manda
-- p.permitir_sobreposicao = true, e só no encaixe e no remarcar feitos pelo dono, depois de ele confirmar.
-- O agendamento pelo site e o barbeiro continuam barrados pelo conflito.
-- Muda só a linha do conflito nas duas funções; o resto do corpo fica igual ao que está no banco.
-- Rodar de novo não muda nada (só troca se a função ainda não tem a exceção).
do $$
declare
  f text;
  d text;
begin
  foreach f in array array['public.criar_pedido(jsonb)', 'public.remarcar_pedido(jsonb)'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position('permitir_sobreposicao' in d) = 0 then
      d := replace(d, 'if v_conflito is not null then',
        'if v_conflito is not null and not coalesce((p->>''permitir_sobreposicao'')::boolean, false) then');
      execute d;
    end if;
  end loop;
end $$;
