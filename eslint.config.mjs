// Portões de qualidade do ESLint (só o nível rápido: o projeto é JavaScript puro, sem TypeScript).
// As regras quality/* vêm copiadas sem alteração do vibe-coding-toolkit (templates/eslint) em eslint-rules/.
//
// Formato do código deste projeto:
//   - api/, lib/, scripts/ e tests/ rodam no Node, em CommonJS (require/module.exports);
//   - os .js da raiz (conta.js, painel-*.js, sw.js...) são scripts clássicos do navegador, sem import.
//
// Fora daqui, de propósito:
//   - quality/no-direct-data-access: a regra só enxerga `import` (ESM). O banco (lib/supabase.js) só é
//     carregado com require() no servidor, e o código do navegador não importa nada: fala com a API por
//     fetch e só recebe a chave pública. Não há como essa fronteira ser quebrada por import, então a regra
//     ficaria sempre muda.
//   - import-x/no-restricted-paths: o projeto não tem camadas de import para proteger.
//
// Severidades novas medidas em 2026-11-23 (`npm run lint`). Regra com violações começa em "warn" com a
// contagem ao lado: essa é a linha de base. Quando chegar a zero, a regra volta para "error".
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

import quality from "./eslint-rules/index.cjs";

const testFiles = [
  "**/*{.,-}{test,spec}.{js,mjs,cjs}",
  "**/{__tests__,__mocks__,fixtures,mocks}/**/*.{js,mjs,cjs}",
];

// Arquivos que rodam no Node (CommonJS).
const nodeFiles = ["api/**/*.js", "lib/**/*.js", "scripts/**/*.js", "tests/**/*.js"];

export default defineConfig([
  js.configs.recommended,
  {
    files: nodeFiles,
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    // O gerador monta as páginas das barbearias: bioRuntime, agendaRuntime e appRuntime são funções
    // serializadas para dentro do HTML e rodam no navegador, não no Node.
    files: ["lib/gerador.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    // Scripts clássicos do navegador: compartilham variáveis globais entre si.
    files: ["*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        Conta: "readonly", // definido por conta.js (window.Conta)
      },
    },
  },
  {
    // qr.js também é carregado pelos testes no Node: `typeof module` decide se exporta.
    files: ["qr.js"],
    languageOptions: {
      globals: { module: "readonly" },
    },
  },
  {
    files: ["sw.js"],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { quality },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-var": "warn", // linha de base: 856 (scripts do navegador e runtimes do gerador escritos com var)
      "prefer-const": "warn", // linha de base: 14
      "no-unused-vars": [
        "warn", // linha de base: 61
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Do js.configs.recommended, com violações já existentes:
      "no-useless-escape": "warn", // linha de base: 7
      "no-control-regex": "warn", // linha de base: 6
      "no-irregular-whitespace": "warn", // linha de base: 1
      "no-regex-spaces": "warn", // linha de base: 1
      // Orçamento de tamanho e complexidade: tudo "warn" de propósito (conversa sobre fatoração, não portão).
      complexity: ["warn", 12],
      "max-depth": ["warn", 4],
      "max-statements": ["warn", 20],
      "max-params": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        { max: 150, skipBlankLines: true, skipComments: true },
      ],
      "max-nested-callbacks": ["warn", 3],
      "quality/max-lines": ["warn", { max: 350 }], // linha de base: 11 arquivos acima de 350 linhas
      // O projeto não tem um módulo de log: o servidor escreve no console e a Vercel guarda os logs.
      "quality/no-direct-console": [
        "warn", // linha de base: 29 (em api/ e lib/)
        { logger: "um módulo de log do projeto (ainda não existe)" },
      ],
    },
  },
  {
    // Ferramentas de linha de comando: a saída delas É o console (relatório do teste de fumaça, da
    // prévia e da sincronização do criador). Este bloco precisa vir DEPOIS do que liga a regra.
    files: ["scripts/**/*.js"],
    rules: {
      "quality/no-direct-console": "off",
    },
  },
  {
    // Mesmo orçamento de tamanho para testes, em "warn". Fica depois do bloco "error" pelo mesmo motivo.
    files: testFiles,
    plugins: { quality },
    rules: {
      "quality/max-lines": ["warn", { max: 350, includeTests: true }],
    },
  },
  {
    files: testFiles,
    rules: {
      "max-statements": "off",
      "max-lines-per-function": "off",
      "max-nested-callbacks": "off",
    },
  },
  {
    files: ["eslint-rules/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  globalIgnores([
    ".claude/**",
    ".vercel/**",
    "node_modules/**",
    "img/**",
    "supabase/**",
    "planilha/**",
    "docs/**",
    "package-lock.json",
  ]),
]);
