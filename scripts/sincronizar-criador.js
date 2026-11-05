// Mantém o Criador (criador.html) igual aos arquivos do servidor:
// - funções do gerador do site (lib/gerador.js): bioRuntime, agendaRuntime e o corpo de bioHTML;
// - versão do gerador (GERADOR_VERSAO), que impede um Criador antigo de publicar
//   (o Criador manda a versão em cada gravação e o servidor recusa versão diferente).
// Uso: node scripts/sincronizar-criador.js        (grava)
//      node scripts/sincronizar-criador.js --checar (só confere; sai com erro se estiver diferente)
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const ler = (p) => fs.readFileSync(path.join(raiz, p), "utf8").replace(/\r\n/g, "\n");

function faixaDaFuncao(src, nome) {
  const i = src.indexOf("function " + nome + "(");
  if (i < 0) throw new Error("Função não encontrada: " + nome);
  const corpo = src.indexOf("{", src.indexOf(")", i));
  let d = 0;
  for (let k = corpo; k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") {
      d--;
      if (!d) return { ini: i, corpo, fim: k + 1 };
    }
  }
  throw new Error("Função sem fim: " + nome);
}

function sincronizado(criador) {
  const ger = ler("lib/gerador.js");
  let c = criador;

  // Funções inteiras
  for (const nome of ["bioRuntime", "agendaRuntime"]) {
    const g = faixaDaFuncao(ger, nome);
    const k = faixaDaFuncao(c, nome);
    c = c.slice(0, k.ini) + ger.slice(g.ini, g.fim) + c.slice(k.fim);
  }

  // bioHTML: o Criador usa parâmetros padrão (d=s, img=R); o corpo é o mesmo, sem a linha do img padrão
  const g = faixaDaFuncao(ger, "bioHTML");
  const corpoGer = ger.slice(g.corpo, g.fim).replace("\n  img=img||(u=>u);", "");
  const k = faixaDaFuncao(c, "bioHTML");
  c = c.slice(0, k.corpo) + corpoGer + c.slice(k.fim);

  // Versão do gerador
  const versao = (ger.match(/VERSAO:(\d+)/) || [])[1];
  if (!versao) throw new Error("VERSAO não encontrada em lib/gerador.js");
  if (/const GERADOR_VERSAO = \d+;/.test(c)) c = c.replace(/const GERADOR_VERSAO = \d+;/, `const GERADOR_VERSAO = ${versao};`);
  else c = c.replace("const FONTS = {", `const GERADOR_VERSAO = ${versao};\nconst FONTS = {`);

  // api/precos.js e painel.html não vão mais embutidos: o Criador só publica arquivos do site
  // (o servidor também recusa qualquer outro arquivo; ver api/criador-gh.js)
  return c;
}

function principal() {
  const atual = ler("criador.html");
  const novo = sincronizado(atual);
  if (process.argv.includes("--checar")) {
    if (novo !== atual) {
      console.error("criador.html está diferente do gerador/arquivos do servidor. Rode: node scripts/sincronizar-criador.js");
      process.exit(1);
    }
    console.log("criador.html sincronizado.");
    return;
  }
  fs.writeFileSync(path.join(raiz, "criador.html"), novo);
  console.log(novo === atual ? "Nada a mudar." : "criador.html atualizado.");
}

if (require.main === module) principal();
module.exports = { sincronizado, faixaDaFuncao, ler };
