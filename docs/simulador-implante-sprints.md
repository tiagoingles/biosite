# Simulador de implante (prótese capilar): plano em sprints

Criado em 25/11/2026. Situação: planejado, nada construído ainda.

## O que é

O barbeiro tira uma foto do cliente na cadeira e, em segundos, mostra como ele fica com a prótese capilar
("implante capilar sem cirurgia"): antes e depois, para mandar no WhatsApp do cliente. O objetivo é fechar
mais vendas de prótese. Começa no painel do dono (aba Prótese); o site público fica para depois.

## Orçamento de tokens (plano Pro)

- Em 25/11, às 15h: cota semanal 72% usada; renova na segunda, 30/11, às 18h (Brasília). Restam 28 pontos.
- O simulador usa no máximo metade: **14 pontos**. Os outros 14 ficam de reserva para o Manolo e correções.
- Teto por sprint, em pontos do medidor semanal: S0 = 2, S1 = 3, S2 = 4, S3 = 3, S4 = 2.
- Regras para gastar pouco:
  1. **Cada sprint numa sessão nova.** A sessão de 25/11 já tem 470 mil tokens de contexto: cada mensagem nela
     custa caro. A sessão nova lê o CLAUDE.md e este arquivo, e mais nada além do que a sprint pede.
  2. No começo e no fim da sprint, conferir o medidor (`get_usage`). Se chegar no teto: parar num ponto seguro
     (testes verdes, commit), anotar no Registro onde parou e não publicar nada pela metade.
  3. Ler trechos (grep, intervalo de linhas), não arquivos inteiros. Prévia no navegador só no fim, numa passada.
  4. As sprints 3 e 4 são mais mecânicas: dá para rodar no Sonnet, que gasta menos da cota.
- **Caminho mínimo**, se a cota apertar: S0 + S1 + S2 já entregam o simulador funcionando, publicado só para a
  Barbearia Modelo. S3 e S4 podem ir para a semana seguinte.

## Decisões

| # | Decisão | Recomendação | Quem decide |
|---|---------|--------------|-------------|
| 1 | IA ou montagem manual (desenho de cabelo por cima da foto) | IA: o realismo é o que vende a prótese. A montagem manual fica como plano B se a IA decepcionar no Sprint 0. | Tiago |
| 2 | Provedor de IA | Testar primeiro a edição de imagem do Google Gemini. Plano B: FLUX Kontext (Replicate) ou OpenAI. Critérios: rosto igual (só muda o cabelo), preço e termos de uso (não treinar com as fotos). | Sprint 0 |
| 3 | Onde fica | Painel do dono, aba Prótese (cliente na cadeira). Site público depois: abuso, custo e LGPD pedem mais cuidado. | Tiago |
| 4 | Quem paga | Só barbearias com o simulador ligado (como o WhatsApp Premium), com limite por mês (ex.: 100 simulações). O preço sai depois de saber o custo real. | Tiago |
| 5 | Fotos | Não guardar por padrão. Guardar na ficha só se o cliente autorizar, com opção de apagar. | Tiago |

## Antes do Sprint 0 (só o Tiago pode fazer)

- Criar a conta no provedor (Google AI Studio, para o Gemini) com cobrança ativa (o plano pago não usa as fotos
  para treinar a IA) e um limite de gasto por mês (ex.: US$ 10).
- Gerar a chave da API e cadastrar na Vercel como variável `SIMULADOR_CHAVE` (Production e Preview).
  O Claude não lê nem digita chaves: só confere se o nome da variável existe.
- Separar 3 fotos de teste com autorização (pode ser a do próprio Tiago): de frente, com entradas ou calvície
  à mostra.

## Sprints

### Sprint 0 · qui 26/11 · decisões e prova de conceito (teto: 2 pontos)

Objetivo: saber se a IA entrega um resultado bom o bastante, a que custo e em quanto tempo.
- Conferir na documentação oficial do provedor: nome do modelo, preço por imagem, tamanho máximo da foto e
  termos de uso dos dados.
- Script local `scripts/simulador-teste.js` (fora do deploy): manda uma foto mais a instrução e salva o
  resultado na pasta temporária. Testar 3 fotos × 2 ou 3 versões da instrução (linha frontal natural,
  volume médio, mesma cor do cabelo; manter rosto, pele, luz e fundo iguais).
- Medir: tempo de resposta, custo por imagem e se o rosto ficou igual.
- Conferir o tempo máximo das funções no plano da Vercel. Se a geração passar do limite, configurar
  `maxDuration` de `api/equipe.js` no `vercel.json`.
- Entrega: tabela de resultados neste arquivo, decisão 2 fechada e a instrução (prompt) escolhida.
- Se nenhum provedor servir: parar e conversar com o Tiago (plano B: montagem manual).

### Sprint 1 · sex 27/11 · servidor (teto: 3 pontos)

- Migração fase 40, só acrescentando: `barbearias.simulador_ativo boolean not null default false`; tabela
  `simulacoes` (id, barbearia_id, profissional_id, protese_cliente_id, criado_em, provedor, ms, ok, erro).
  Nenhuma foto no banco. RLS ligada, sem políticas (só o servidor).
- `lib/simulador.js` e rota `POST /api/equipe?area=simulador`. Não criar função nova: já são 12 de 12.
  Só o dono, e só de barbearia com o simulador ligado.
- Entrada: foto JPEG em base64 (até uns 1,5 MB, já reduzida no navegador), opções {linha, volume, cor} e
  `autorizou: true`. Saída: a imagem gerada, em base64. Nada fica guardado.
- Limites: 3 por minuto e N por mês por barbearia (contando em `simulacoes`); 429 com mensagem clara.
- Erro ou demora do provedor viram mensagem simples ("Não deu para gerar agora. Tente de novo.").
- Testes com o provedor simulado: sucesso; foto grande demais; sem autorização; simulador desligado (403);
  barbeiro e outra barbearia (403); limite (429); erro e demora do provedor.
- Prévia local: resposta falsa (a própria foto com a marca "simulação").

### Sprint 2 · sáb 28/11 · tela no painel (teto: 4 pontos)

- Aba Prótese: botão "Simular implante" no topo e "Simular" em cada ficha.
- Janela: "Tirar foto" (câmera) ou "Escolher da galeria" → a foto aparece → caixa obrigatória "O cliente
  autorizou usar a foto para a simulação" → opções em botões (linha frontal: natural, reta ou mais baixa;
  volume: leve, médio ou cheio; cor: igual ao cabelo, mais escura ou mais clara) → "Gerar" (espera de 10 a
  20 s, com aviso na tela).
- No navegador: reduzir a foto para 1024 px em JPEG, sem dados de localização (EXIF) e na posição certa.
- Resultado: antes e depois com barra de arrastar; "Compartilhar" (o compartilhar do celular leva a imagem ao
  WhatsApp) e "Baixar"; "Gerar outra" com outras opções.
- Publicar ligado só na Barbearia Modelo. Conferir no celular, em pé e deitado.

### Sprint 3 · dom 29/11 · guardar na ficha (teto: 3 pontos, se a cota deixar)

- "Guardar na ficha", só com a autorização do cliente: antes e depois no Storage do Supabase, em pasta
  privada, abertos por link temporário.
- A ficha de prótese mostra as simulações em miniatura, com "Mandar de novo" e "Apagar fotos".
- Prazo de guarda (ex.: 1 ano ou até o cliente pedir) e o aviso de privacidade (LGPD) no painel.
- Testes.

### Sprint 4 · seg 30/11, até 18h · acabamento e lançamento (teto: 2 pontos)

- Revisar textos, mensagens de erro e o custo real por simulação da semana.
- Demonstrações (Modelo e Exemplo): um exemplo pronto, sem chamar a IA (custo zero).
- Ligar para a Dom Manolo (com o OK do Tiago) e preparar a mensagem para o Manolo.
- Atualizar este arquivo e a memória.

## Registro

| Sprint | Data | Medidor (início → fim) | Entregue | Commit |
|--------|------|------------------------|----------|--------|
| Planejamento | 25/11 | 72% → ver no fim | este arquivo | |
