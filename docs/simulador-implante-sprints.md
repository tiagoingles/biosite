# Simulador de prótese capilar na câmera: plano em sprints

Plano refeito em 25/11/2026. Substitui a ideia anterior (IA gerando uma foto, commit 2bdd890).
Situação: **planejado e aprovado pelo Tiago em 25/11 (as 5 decisões abaixo seguem as recomendações). Nada construído.**

## O que é

No site da barbearia, o cliente toca em "Experimentar na câmera", abre a câmera do celular e vê a prótese na
cabeça dele em tempo real, como um filtro de Instagram. Troca entre alguns modelos e escolhe um. Ao enviar o
agendamento, o modelo escolhido vai junto com o pedido e o barbeiro vê no painel.

- Tudo roda no celular do cliente: o vídeo não sai do aparelho (bom para a LGPD) e não há custo por uso.
- Não precisa de chave de IA nem de `SIMULADOR_CHAVE`. Nada para o Tiago cadastrar na Vercel.
- É um filtro 2D, não uma foto pronta: a tela avisa "Simulação ilustrativa. O resultado real pode variar."

## Desenho técnico

Conferido em 25/11: o pacote `@mediapipe/tasks-vision` existe no jsDelivr (última versão estável 1.2.3) e o
modelo `face_landmarker.task` (float16) responde no armazenamento do Google. Os nomes exatos das opções da
biblioteca (`runningMode: "VIDEO"`, `outputFacialTransformationMatrixes: true`, `delegate: "GPU"`) devem ser
conferidos de novo na documentação oficial no começo do Sprint 0, antes de fixar a versão.

- **Rastreio do rosto:** MediaPipe Face Landmarker, versão fixa pelo jsDelivr. `detectForVideo` a cada quadro;
  a matriz de transformação do rosto dá giro e escala. Se o Google mudar a URL do modelo, guardar o
  `face_landmarker.task` (uns 4 MB) dentro do projeto.
- **Desenho:** `<canvas>` por cima do `<video>` (câmera frontal, espelhada). A prótese é um PNG com fundo
  transparente, ancorado nos pontos da testa e das têmporas. Ajustes do cliente: tamanho, giro, cor (mais
  escura ou mais clara) e transparência.
- **Arquivo próprio `simulador.js` na raiz**, carregado só quando o cliente toca em "Experimentar na câmera",
  para o site continuar leve. A biblioteca e o modelo também só baixam nesse momento.
- **Câmera:** `getUserMedia({ video: { facingMode: "user" } })`, vídeo com `playsinline` e `muted` (iPhone).
  Sem câmera, ou em navegador de aplicativo que bloqueia (Instagram, WhatsApp): mensagem "Abra no navegador do
  celular" e a opção de usar uma foto da galeria com o mesmo filtro (a foto fica só no aparelho).
- **Botão no gerador** (`lib/gerador*.js`). Depois de mexer: aumentar `VERSAO`, rodar
  `node scripts/sincronizar-criador.js` e regenerar só os 5 sites de barbearia.
- **Agendamento:** campo novo `pedidos.protese_modelo` (migração só acrescentando, texto curto), enviado pelo
  site junto com o pedido e validado em `api/pedido.js` (só aceita códigos de modelos conhecidos). Aparece no
  cartão do pedido no painel e na ficha de prótese. Sem função nova na Vercel (já são 12 de 12).
- **Testes:**
  - a conta de posição, escala e giro a partir dos pontos do rosto é uma função pura (`lib` ou dentro do
    `simulador.js`, exportável), com teste;
  - testes de texto para o botão no gerador e para o campo no pedido;
  - a câmera é conferida à mão; a prévia local usa uma foto no lugar da câmera.

## Orçamento de tokens (plano Pro)

- Em 25/11, no começo desta sessão: cota semanal 73%; renova na segunda, 30/11, às 18h. Restam 27 pontos.
- O simulador usa no máximo **14 pontos**. A outra metade fica de reserva para o Manolo e correções.
- Teto por sprint, em pontos do medidor semanal: S0 = 2, S1 = 3, S2 = 4, S3 = 3, S4 = 2.
- Regras:
  1. Cada sprint numa sessão nova, que lê só o CLAUDE.md e este arquivo.
  2. `get_usage` no começo e no fim de cada sprint, anotado no Registro. Chegou no teto: parar num ponto
     seguro (testes verdes, commit feito, nada publicado pela metade) e anotar onde parou.
  3. Ler trechos (grep, intervalos de linhas), não arquivos inteiros. Prévia no navegador só no fim.
  4. As sprints mais mecânicas (S3, S4) podem rodar no Sonnet.
- **Caminho mínimo:** S0 + S1 + S2 + S3 entregam o filtro publicado no site com o modelo indo no agendamento,
  ligado só na Barbearia Modelo. S4 vai para a semana seguinte se a cota apertar.

## Decisões (aprovadas pelo Tiago em 25/11)

| # | Decisão | Recomendação |
|---|---------|--------------|
| 1 | De onde vêm as imagens dos modelos (PNG transparente) | **Gerar uma vez com uma IA de imagem** (custo único, baixo) e conferir no celular; se o resultado ficar feio, fotografar as próteses da Dom Manolo contra fundo liso e recortar (é o mais fiel ao produto real). Imagens compradas só se as outras duas falharem (licença e preço). No Sprint 0 usa-se uma imagem provisória. |
| 2 | Quantos e quais modelos no começo | **4 modelos** com nomes simples: "Natural", "Volume", "Entradas" (preenche as entradas) e "Topo" (preenche o topo). Dá para começar com 3 e crescer. A lista fica num arquivo único, fácil de editar. |
| 3 | Cliente pode mandar uma foto junto com o agendamento | **Não no começo.** Só o nome do modelo vai no pedido. Foto exige guardar imagem de rosto (LGPD, armazenamento, consentimento). Pode vir depois, com autorização. |
| 4 | Limite de realismo | **Deixar claro na tela**: aviso fixo "Simulação ilustrativa em 2D. O resultado real pode variar", e o barbeiro mostra a prótese real na consulta. |
| 5 | Onde liga | **Só na Barbearia Modelo** primeiro; depois Manolo com o seu OK. Ligar por sites que têm a seção de prótese. |

## Sprints

### Sprint 0 · qui 26/11 · prova de conceito (teto: 2 pontos)

Objetivo: ver o filtro funcionando numa página de teste e fechar as decisões.
- Conferir na documentação oficial: versão, nomes das opções, URL do modelo, suporte no iPhone (Safari).
- Página local `scripts/simulador-teste.html` (fora do deploy, `.vercelignore`): câmera ou foto, Face
  Landmarker, um PNG provisório ancorado na testa.
- Função pura da conta (posição, escala, giro) com testes.
- Medir: quadros por segundo e peso do download (biblioteca + modelo) num celular.
- Entrega: resultado anotado aqui e decisões 1 e 2 fechadas.
- Se o encaixe ficar ruim demais: parar e conversar com o Tiago.

### Sprint 1 · sex 27/11 · `simulador.js` completo (teto: 3 pontos)

- `simulador.js` na raiz: abrir câmera, trocar modelo, ajustes (tamanho, giro, cor, transparência), tirar
  "foto da tela" opcional, aviso de realismo, tela de erro e opção da galeria.
- Lista de modelos (códigos, nomes, PNGs) em um arquivo só.
- Mensagem para navegadores de aplicativo; permissão negada; sem câmera.
- Prévia local com foto no lugar da câmera. Testes da parte pura.

### Sprint 2 · sáb 28/11 · site e agendamento (teto: 4 pontos)

- Migração `pedidos.protese_modelo` (texto curto, só acrescenta).
- Botão "Experimentar na câmera" no gerador (seção de prótese), carregando `simulador.js` só no toque; o
  modelo escolhido é enviado com o pedido e validado em `api/pedido.js`.
- Painel: modelo no cartão do pedido e na ficha de prótese.
- `VERSAO` mais alta, sincronizar o Criador, regenerar os 5 sites. Testes de texto.
- Publicar ligado só na Barbearia Modelo.

### Sprint 3 · dom 29/11 · conferir no celular e ajustar (teto: 3 pontos)

- Conferir no iPhone e no Android, em pé e deitado, e em navegador de aplicativo.
- Ajustar âncoras, tamanho e cor dos modelos finais (trocar o PNG provisório).
- Corrigir o que o teste de mão achar.

### Sprint 4 · seg 30/11, até 18h · acabamento e lançamento (teto: 2 pontos)

- Revisar textos e mensagens de erro. Demonstrações (Modelo e Exemplo) com o filtro.
- Preparar a mensagem para o Manolo e ligar nele com o OK do Tiago.
- Atualizar este arquivo e a memória.

## Registro

| Sprint | Data | Medidor (início → fim) | Entregue | Commit |
|--------|------|------------------------|----------|--------|
| Planejamento (IA, antigo) | 25/11 | 72% → ? | plano anterior | 2bdd890 |
| Replanejamento (câmera) | 25/11 | 73% → ? | este arquivo | |
