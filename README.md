# biosite

Mini sites dos clientes, publicados pelo Criador de Bio.

- `<cliente>.html`: o site de cada cliente (endereço `/<cliente>`)
- `<cliente>-avaliar.html`: atalho para a avaliação no Google (usado na plaquinha NFC)
- `img/<cliente>/`: fotos
- `painel.html` + `api/precos.js`: painel em que o dono muda preços (`/painel?s=<cliente>`)
- `admin/<cliente>.json`: código de acesso do painel e da planilha (apenas o hash)
- `api/sincronizar.js`: recebe o catálogo da planilha Google do cliente e publica
- `lib/gerador.js`: gera o HTML dos sites (mesma cópia usada pelo Criador)
- `lib/servidor.js`: funções compartilhadas das APIs
- `planilha/Codigo.gs`: script que vai dentro da planilha modelo (Extensões > Apps Script)

Variáveis na Vercel: `GITHUB_TOKEN` e `GITHUB_REPO`.
