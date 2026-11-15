// QR code (ISO/IEC 18004) sem bibliotecas de fora: o painel desenha o QR do link de cadastro do cliente.
// Modo byte (UTF-8), correção de erro nível M, versões 1 a 10 (até 213 bytes, sobra para um link).
// Segue a estrutura do gerador de referência de Project Nayuki (MIT): blocos com Reed-Solomon,
// padrões fixos, colocação em zigue-zague e escolha da máscara com menos penalidade.
// Uso: QR.matriz("https://...") -> { tamanho, modulos[y][x] (true = escuro) }; QR.svg(texto) -> "<svg ...>".
(function (raiz) {
  "use strict";
  var NIVEL_M = 0; // bits do nível M no campo de formato (L=1, M=0, Q=3, H=2)
  // Códigos de correção por bloco e número de blocos, nível M, versões 1 a 10 (índice 0 sem uso)
  var ECC_POR_BLOCO = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  var BLOCOS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  var VERSAO_MAX = 10;

  // Módulos de dados de uma versão (área total menos os padrões fixos)
  function modulosDeDados(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function codewordsDeDados(ver) {
    return Math.floor(modulosDeDados(ver) / 8) - ECC_POR_BLOCO[ver] * BLOCOS[ver];
  }

  // ---------- Reed-Solomon em GF(2^8), polinômio 0x11D ----------
  function multiplicar(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function divisor(grau) {
    var r = [];
    for (var i = 0; i < grau - 1; i++) r.push(0);
    r.push(1);
    var raizG = 1;
    for (var k = 0; k < grau; k++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = multiplicar(r[j], raizG);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      raizG = multiplicar(raizG, 0x02);
    }
    return r;
  }
  function resto(dados, div) {
    var r = div.map(function () { return 0; });
    dados.forEach(function (b) {
      var fator = b ^ r.shift();
      r.push(0);
      div.forEach(function (coef, i) { r[i] ^= multiplicar(coef, fator); });
    });
    return r;
  }

  // Dados divididos em blocos, cada um com o seu código de correção, e intercalados
  function comCorrecao(dados, ver) {
    var nBlocos = BLOCOS[ver], eccLen = ECC_POR_BLOCO[ver];
    var total = Math.floor(modulosDeDados(ver) / 8);
    var curtos = nBlocos - (total % nBlocos);
    var tamCurto = Math.floor(total / nBlocos);
    var div = divisor(eccLen);
    var blocos = [];
    for (var i = 0, k = 0; i < nBlocos; i++) {
      var dat = dados.slice(k, k + tamCurto - eccLen + (i < curtos ? 0 : 1));
      k += dat.length;
      var ecc = resto(dat, div);
      if (i < curtos) dat.push(0);
      blocos.push(dat.concat(ecc));
    }
    var saida = [];
    for (var c = 0; c < blocos[0].length; c++) {
      blocos.forEach(function (bl, j) {
        if (c !== tamCurto - eccLen || j >= curtos) saida.push(bl[c]);
      });
    }
    return saida;
  }

  function utf8(texto) {
    var s = unescape(encodeURIComponent(String(texto)));
    var b = [];
    for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i));
    return b;
  }

  // Bits do segmento em modo byte -> codewords de dados com preenchimento (0xEC, 0x11)
  function codewords(bytes, ver) {
    var bits = [];
    function poe(valor, n) { for (var i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); }
    poe(0x4, 4);
    poe(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(function (b) { poe(b, 8); });
    var cap = codewordsDeDados(ver) * 8;
    poe(0, Math.min(4, cap - bits.length));
    poe(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) poe(pad, 8);
    var out = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      out.push(v);
    }
    return out;
  }

  function posicoesAlinhamento(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var passo = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6];
    for (var pos = ver * 4 + 10; r.length < n; pos -= passo) r.splice(1, 0, pos);
    return r;
  }

  // Bits de formato (nível + máscara) com BCH(15,5) e a máscara fixa 0x5412
  function bitsDeFormato(mascara) {
    var dados = (NIVEL_M << 3) | mascara;
    var rem = dados;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((dados << 10) | rem) ^ 0x5412;
  }
  // Bits de versão (versão 7 em diante) com BCH(18,6)
  function bitsDeVersao(ver) {
    var rem = ver;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    return (ver << 12) | rem;
  }

  function mascarar(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  }

  function montar(ver, todos) {
    var n = ver * 4 + 17;
    var mod = [], fixo = [];
    for (var y = 0; y < n; y++) {
      mod.push([]);
      fixo.push([]);
      for (var x = 0; x < n; x++) { mod[y].push(false); fixo[y].push(false); }
    }
    function poe(x, y, escuro) { mod[y][x] = escuro; fixo[y][x] = true; }
    // Linhas de sincronismo
    for (var i = 0; i < n; i++) { poe(6, i, i % 2 === 0); poe(i, 6, i % 2 === 0); }
    // Localizadores (com a margem clara em volta)
    [[3, 3], [n - 4, 3], [3, n - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), xx = c[0] + dx, yy = c[1] + dy;
        if (xx >= 0 && xx < n && yy >= 0 && yy < n) poe(xx, yy, d !== 2 && d !== 4);
      }
    });
    // Alinhamento
    var al = posicoesAlinhamento(ver);
    al.forEach(function (ay, a) {
      al.forEach(function (ax, b) {
        if ((a === 0 && b === 0) || (a === 0 && b === al.length - 1) || (a === al.length - 1 && b === 0)) return;
        for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) poe(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      });
    });
    function formato(mascara) {
      var bits = bitsDeFormato(mascara);
      function bit(i) { return ((bits >>> i) & 1) === 1; }
      for (var i = 0; i <= 5; i++) poe(8, i, bit(i));
      poe(8, 7, bit(6));
      poe(8, 8, bit(7));
      poe(7, 8, bit(8));
      for (i = 9; i < 15; i++) poe(14 - i, 8, bit(i));
      for (i = 0; i < 8; i++) poe(n - 1 - i, 8, bit(i));
      for (i = 8; i < 15; i++) poe(8, n - 15 + i, bit(i));
      poe(8, n - 8, true); // módulo escuro fixo
    }
    formato(0);
    if (ver >= 7) {
      var bv = bitsDeVersao(ver);
      for (var k = 0; k < 18; k++) {
        var on = ((bv >>> k) & 1) === 1, a1 = n - 11 + (k % 3), b1 = Math.floor(k / 3);
        poe(a1, b1, on);
        poe(b1, a1, on);
      }
    }
    // Dados em zigue-zague, de duas em duas colunas, da direita para a esquerda (pulando a coluna 6)
    var idx = 0;
    for (var dir = n - 1; dir >= 1; dir -= 2) {
      if (dir === 6) dir = 5;
      for (var v = 0; v < n; v++) {
        for (var j = 0; j < 2; j++) {
          var cx = dir - j, subindo = ((dir + 1) & 2) === 0, cy = subindo ? n - 1 - v : v;
          if (!fixo[cy][cx] && idx < todos.length * 8) {
            mod[cy][cx] = ((todos[idx >>> 3] >>> (7 - (idx & 7))) & 1) === 1;
            idx++;
          }
        }
      }
    }
    return { n: n, mod: mod, fixo: fixo, formato: formato };
  }

  function aplicarMascara(q, m) {
    for (var y = 0; y < q.n; y++) for (var x = 0; x < q.n; x++) if (!q.fixo[y][x] && mascarar(m, x, y)) q.mod[y][x] = !q.mod[y][x];
  }

  // Penalidade da norma (4 regras): blocos da mesma cor, quadrados 2x2, padrão parecido com o
  // localizador e desequilíbrio entre claro e escuro. Usada só para escolher a melhor máscara.
  function penalidade(mod) {
    var n = mod.length, p = 0, x, y;
    function linhas(get) {
      for (var a = 0; a < n; a++) {
        var corrida = 1;
        for (var b = 1; b <= n; b++) {
          if (b < n && get(a, b) === get(a, b - 1)) corrida++;
          else { if (corrida >= 5) p += 3 + (corrida - 5); corrida = 1; }
        }
        var s = "";
        for (b = 0; b < n; b++) s += get(a, b) ? "1" : "0";
        var padrao = /(?=(10111010000|00001011101))/g, mt;
        while ((mt = padrao.exec(s))) { p += 40; padrao.lastIndex = mt.index + 1; }
      }
    }
    linhas(function (a, b) { return mod[a][b]; });
    linhas(function (a, b) { return mod[b][a]; });
    for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++) {
      var c = mod[y][x];
      if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
    }
    var escuros = 0;
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (mod[y][x]) escuros++;
    var k = Math.ceil(Math.abs(escuros * 20 - n * n * 10) / (n * n)) - 1;
    return p + Math.max(0, k) * 10;
  }

  function matriz(texto) {
    var bytes = utf8(texto);
    var ver = 1;
    while (ver <= VERSAO_MAX && bytes.length + (ver <= 9 ? 2 : 3) > codewordsDeDados(ver)) ver++;
    if (ver > VERSAO_MAX) throw new Error("Texto longo demais para o QR code.");
    var q = montar(ver, comCorrecao(codewords(bytes, ver), ver));
    var melhor = 0, menor = Infinity;
    for (var m = 0; m < 8; m++) {
      aplicarMascara(q, m);
      q.formato(m);
      var pen = penalidade(q.mod);
      if (pen < menor) { menor = pen; melhor = m; }
      aplicarMascara(q, m); // desfaz
    }
    aplicarMascara(q, melhor);
    q.formato(melhor);
    return { tamanho: q.n, versao: ver, mascara: melhor, modulos: q.mod };
  }

  // SVG com margem de 4 módulos (a norma pede) e um caminho só, nítido em qualquer tamanho
  function svg(texto, opcoes) {
    opcoes = opcoes || {};
    var q = matriz(texto), borda = 4, total = q.tamanho + borda * 2, d = "";
    for (var y = 0; y < q.tamanho; y++) for (var x = 0; x < q.tamanho; x++) if (q.modulos[y][x]) d += "M" + (x + borda) + "," + (y + borda) + "h1v1h-1z";
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + " " + total + '" shape-rendering="crispEdges" role="img" aria-label="' + (opcoes.rotulo || "QR code") + '"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
  }

  var QR = { matriz: matriz, svg: svg, _: { multiplicar: multiplicar, divisor: divisor, resto: resto, bitsDeFormato: bitsDeFormato, bitsDeVersao: bitsDeVersao, posicoesAlinhamento: posicoesAlinhamento, codewordsDeDados: codewordsDeDados, modulosDeDados: modulosDeDados, comCorrecao: comCorrecao, codewords: codewords, montar: montar } };
  if (typeof module === "object" && module.exports) module.exports = QR;
  else raiz.QR = QR;
})(this);
