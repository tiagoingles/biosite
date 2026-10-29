# biosite

Mini sites dos clientes, publicados pelo Criador de Bio.

- `<cliente>.html`: o site de cada cliente (endereço `/<cliente>`)
- `<cliente>-avaliar.html`: atalho para a avaliação no Google (usado na plaquinha NFC)
- `img/<cliente>/`: fotos
- `painel.html` + `api/precos.js`: painel em que o dono muda preços (`/painel?s=<cliente>`)
- `admin/<cliente>.json`: código de acesso do painel (apenas o hash)

Variáveis na Vercel: `GITHUB_TOKEN` e `GITHUB_REPO`.
