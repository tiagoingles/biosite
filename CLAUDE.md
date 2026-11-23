# biosite (barbeirotop)

Sites e agendamento para barbearias. Node puro, sem dependências em produção (o ESLint é só de desenvolvimento).
Deploy: push na `main` → Vercel (biosite-dusky.vercel.app e barbeirotop.com.br). Banco: Supabase pela API REST.

## Onde fica cada coisa
- `api/*.js` — funções da Vercel. **O plano Hobby permite no máximo 12, e já são 12:** rota nova entra numa existente (`?area=`, `b.acao`).
- `lib/*.js` — regras do servidor (CommonJS). O nome do arquivo diz o assunto (`clientes`, `clube`, `financeiro`, `caixa`, `pix`, `stripe`...). `lib/supabase.js` é o único acesso ao banco.
- `lib/gerador.js` + `lib/gerador-{pedido,agenda,app,estilos}.js` — geram o HTML dos sites. As funções `*Runtime` viram texto (`toString()`) dentro da página: não podem usar nada de fora delas.
- `criador.html` — o Criador (navegador). Recebe cópias das funções do gerador por `scripts/sincronizar-criador.js`.
- Raiz: `<barbearia>.html` (sites gerados), `painel-*.js` (painéis, scripts clássicos de navegador que se comunicam por `window.Painel` e `window.Clientes`), `conta.js`, `sw.js`.
- Aba Clientes: `painel-clientes.js` (núcleo e estado) + `painel-clientes-{ficha,cadastro,planilha,campanhas}.js`, carregados depois dele (por `window.Clientes.interno`).
- `scripts/previa.js` (+ `previa-dados.js`, `previa-equipe.js`) — prévia local dos painéis com dados fictícios.
- `supabase/*.sql` — esquema e migrações por fase. `tests/*.test.js` — testes com banco e GitHub simulados.

## Comandos
- `npm test` — todos os testes (não precisam de segredos).
- `node scripts/sincronizar-criador.js --checar` — confere que o Criador está igual ao gerador (o CI roda). Sem `--checar`, atualiza.
- `npm run lint` — ESLint 9. Os avisos são a linha de base registrada em `eslint.config.mjs`; **erro** quebra.
- `node scripts/previa.js` → http://localhost:4321/previa (painel do dono, do barbeiro, admin, convite).
- `node scripts/fumaca.js` — teste de fumaça do site no ar (só leitura; o primeiro após um deploy pode demorar).

## Armadilhas
- Mudou o gerador? Rode o sincronizador do Criador e regenere os sites `.html` (o `tests/gerador.test.js` compara). Mudança no HTML gerado pede aumentar `VERSAO` em `lib/gerador.js`.
- O `sincronizar-criador` acha funções contando `{` e `}`: não coloque chaves desbalanceadas (CSS cortado no meio, texto) dentro dessas funções.
- Vários testes procuram **texto** nos arquivos (`ler("arquivo.js")`). Ao mover código, atualize o caminho; para a aba Clientes use `lerAbaClientes()` de `tests/ajuda.js`.
- Windows desta máquina: `core.autocrlf` vira CRLF e quebra testes que comparam texto. Use `git config core.autocrlf false` no clone.
- Edição pelo terminal (heredoc, `node -e`, python) estraga barras invertidas (`\n`, `\d`, `\s`): edite com a ferramenta de edição ou escreva o script num arquivo.
- `/lib/*` é bloqueado no site (vercel.json); a `.vercelignore` tira testes, scripts, docs e config do deploy. Arquivo novo que não deve ficar público entra lá.
- Commit nesta máquina: `git -c user.name=tiagoingles -c user.email=<email do Tiago> commit ...` (não há identidade global). Push para o GitHub às vezes demora: tente de novo.

## Como trabalhar aqui
- Textos para o usuário e comentários em português simples (o dono não é programador).
- Mudança de comportamento só com teste. Refatoração deve manter a saída igual (compare antes e depois).
