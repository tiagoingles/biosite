// Estilos fixos do site gerado (modelos Vitrine, Cartão e Minimal, carrinho, agenda, clube e app).
// As cores e fontes de cada barbearia ficam na linha :root do bioHTML (lib/gerador.js).
function bioEstilos(){
  return `*{box-sizing:border-box}html,body{margin:0}
body{background:var(--fundo);color:var(--texto);font:16px/1.5 var(--fb);min-height:100vh}
body.tem-cat{padding-bottom:96px}
.pg{max-width:560px;margin:0 auto;padding:0 16px 40px}
svg{width:20px;height:20px;flex:none}
a{color:inherit}
.capa{height:150px;margin:0 -16px;background:var(--cor) center/cover no-repeat}
.topo{display:grid;justify-items:center;text-align:center;padding-top:28px}
.logo{width:92px;height:92px;border-radius:50%;object-fit:cover;background:var(--cor);color:var(--sobre);display:grid;place-items:center;font:700 30px var(--ft);border:4px solid var(--fundo)}
h1{font:700 28px/1.15 var(--ft);margin:10px 0 4px;text-wrap:balance}
.sub{margin:0 0 8px;opacity:.8;max-width:42ch}
.nota{display:inline-flex;align-items:center;gap:6px;margin:2px 0 0;font-size:13px;text-decoration:none;background:var(--suave);padding:4px 12px;border-radius:999px}
.nota svg{color:#f5b301;width:16px;height:16px}
.acoes{display:flex;justify-content:center;gap:20px;margin:18px 0 4px;flex-wrap:wrap}
.acao{display:grid;justify-items:center;gap:5px;text-decoration:none;font-size:12px;font-weight:600}
.acao .ic{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:var(--suave);color:var(--acento);border:1px solid var(--linha)}
.sec{font:700 22px var(--ft);margin:26px 0 12px}
.chips{position:sticky;top:0;z-index:5;display:flex;gap:8px;overflow-x:auto;padding:12px 16px;margin:18px -16px 0;background:var(--fundo);scrollbar-width:none;border-bottom:1px solid var(--linha)}
.chips::-webkit-scrollbar{display:none}
.busca{margin:18px 0 0}
.busca input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid var(--linha);border-radius:12px;font:inherit;background:var(--fundo);color:inherit}
.busca-vazio{padding:20px 0;text-align:center;opacity:.7}
.pmeta{display:block;font-size:13px;opacity:.7;margin:2px 0}
.ende-t{font-weight:700;margin:4px 0 0}
.cobertura{font-size:14px;background:var(--suave);border-radius:10px;padding:10px 12px;margin:0}
.duas{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.campos [hidden]{display:none!important}
.prod[hidden],.cat[hidden],.chips[hidden],.busca-vazio[hidden]{display:none!important}
.chips a{white-space:nowrap;text-decoration:none;border:1px solid var(--linha);border-radius:999px;padding:6px 14px;font-size:14px;font-weight:600}
.cat{scroll-margin-top:64px;margin-top:20px}
.cat h2{font:700 20px var(--ft);margin:0 0 10px}
.prods{display:grid;gap:10px}
.prod{display:flex;gap:12px;background:var(--suave);border-radius:14px;padding:10px;min-width:0}
.pimg{width:96px;height:96px;object-fit:cover;border-radius:10px;order:2;flex:none;background:var(--linha)}
.pinfo{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pinfo h3{margin:0;font:700 16px/1.3 var(--fb)}
.pinfo p{margin:0;font-size:13px;opacity:.72;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.prow{margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:8px;padding-top:8px}
.preco{font-size:15px;font-variant-numeric:tabular-nums}
.add{width:34px;height:34px;border-radius:50%;border:0;background:var(--cor);color:var(--sobre);font:600 22px/1 var(--fb);cursor:pointer;flex:none}
.step{display:inline-flex;align-items:center;gap:6px;background:var(--cor);color:var(--sobre);border-radius:999px;padding:2px}
.step b{min-width:16px;text-align:center;font-variant-numeric:tabular-nums}
.step button{width:30px;height:30px;border-radius:50%;border:0;background:transparent;color:inherit;font:600 20px/1 var(--fb);cursor:pointer}
.off .pimg,.off h3,.off .preco{opacity:.5}.esg{font-style:normal;font-size:12px;font-weight:700;opacity:.7}
.bloco{margin-top:24px}
.mais h2,.infos h2{font:700 18px var(--ft);margin:0 0 8px}
.mais a{display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--linha);text-decoration:none;font-weight:600}
.mais a span{flex:1}.mais a em{font-style:normal;opacity:.5}
.avaliar{display:flex;gap:14px;align-items:center;margin-top:26px;padding:16px 18px;border-radius:16px;background:var(--cor);color:var(--sobre);text-decoration:none;font-weight:700}
.avaliar svg{width:28px;height:28px;color:#f5b301}
.avaliar span{display:grid}.avaliar small{font-weight:500;opacity:.85}
.info summary{cursor:pointer;font-weight:600}
.end{display:flex;gap:8px;align-items:flex-start;font-size:14px;opacity:.85;margin:14px 0 0}
.end svg{width:18px;height:18px;margin-top:2px}
.infos{border-top:1px solid var(--linha);padding-top:16px}
footer{margin-top:28px;font-size:12px;opacity:.5;text-align:center}
/* Botões grandes (quando não há produtos) */
.links{display:grid;gap:12px;margin-top:22px}
.btn{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:600;padding:15px 18px;background:var(--cor);color:var(--sobre);border-radius:999px}
.btn span{flex:1}.btn em{font-style:normal;opacity:.6}
.btn.destaque{font-size:17px;padding:18px 20px;box-shadow:0 6px 18px color-mix(in srgb,var(--cor) 40%,transparent)}
/* Carrinho */
.cartbar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom,0px));width:min(528px,calc(100% - 24px));display:flex;align-items:center;gap:10px;padding:14px 18px;border:0;border-radius:14px;background:var(--cor);color:var(--sobre);font:700 15px var(--fb);box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:pointer;z-index:20}
.cartbar #cbQtd{opacity:.85;font-weight:500}.cartbar b{flex:1;text-align:center}
.cartbar[hidden]{display:none}
dialog{border:0;padding:0;width:100%;max-width:560px;max-height:92vh;margin:auto auto 0;border-radius:20px 20px 0 0;background:var(--fundo);color:var(--texto)}
dialog::backdrop{background:rgba(0,0,0,.5)}
.sheet{padding:18px 18px calc(18px + env(safe-area-inset-bottom,0px));display:grid;gap:14px}
.sh-top{display:flex;justify-content:space-between;align-items:center}
.sh-top h2{margin:0;font:700 22px var(--ft)}
.x{width:36px;height:36px;border-radius:50%;border:0;background:var(--suave);color:inherit;font-size:22px;cursor:pointer}
.it{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--linha)}
.it-n{display:grid;min-width:0}.it-n small{opacity:.7;font-variant-numeric:tabular-nums}
.campos{display:grid;gap:10px}
.campos label{display:grid;gap:4px;font-size:14px;font-weight:600}
.campos input:not([type=radio]),.campos textarea,.campos select{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--linha);border-radius:10px;background:var(--suave);color:var(--texto);width:100%}
.campos [hidden]{display:none}
.tipos{display:flex;gap:8px}
.tipos label{flex:1;display:flex;align-items:center;gap:8px;border:1px solid var(--linha);border-radius:10px;padding:10px 12px;cursor:pointer}
.pix{margin:0;font-size:14px;background:var(--suave);padding:10px 12px;border-radius:10px;word-break:break-all}
.tot{display:grid;gap:4px;font-variant-numeric:tabular-nums}
.tot div{display:flex;justify-content:space-between}.tot .final{font-size:18px;font-weight:800;margin-top:4px}
.erro{color:#c0392b;margin:0;font-size:14px;font-weight:600;min-height:0}
.erro:empty{display:none}
.enviar{display:flex;align-items:center;justify-content:center;gap:10px;background:#25d366;color:#08311a;border:0;border-radius:12px;padding:15px;font:800 16px var(--fb);cursor:pointer}
.enviar[hidden]{display:none!important}
button:focus-visible,a:focus-visible{outline:2px solid var(--cor);outline-offset:2px}
/* Modelo Vitrine: capa e produtos em grade */
.t-vitrine .topo{margin-top:-46px;padding-top:0}
.t-vitrine .prods{grid-template-columns:repeat(2,minmax(0,1fr))}
.t-vitrine .prod{flex-direction:column;padding:0;overflow:hidden;background:var(--fundo);border:1px solid var(--linha);gap:0}
.t-vitrine .pimg{order:0;width:100%;height:auto;aspect-ratio:1;border-radius:0}
.t-vitrine .pinfo{padding:10px 10px 12px}
.t-vitrine .prow{flex-wrap:wrap;row-gap:6px}
.t-vitrine .step button{width:28px;height:28px}
/* Modelo Cartão: fundo na cor da marca e blocos claros */
.t-cartao{background:var(--cor)}
.t-cartao .pg{padding-top:20px}
.t-cartao .topo,.t-cartao .bloco,.t-cartao .catalogo{background:var(--fundo);border-radius:22px;padding:22px 16px}
.t-cartao .acoes{margin-bottom:0}
.t-cartao .catalogo{margin-top:16px;padding-top:6px}
.t-cartao .bloco{margin-top:16px}
.t-cartao .chips{margin:12px -16px 0;border-radius:0}
.t-cartao .prod{background:var(--suave)}
.t-cartao .avaliar{background:var(--fundo);color:var(--texto);border:2px solid var(--fundo)}
.t-cartao footer{color:var(--sobre);opacity:.75}
.t-cartao .infos{border-top:0}
/* Modelo Minimal: lista com linhas finas */
.t-minimal .topo{justify-items:start;text-align:left;padding-top:36px}
.t-minimal .logo{width:68px;height:68px;border-radius:16px;border:0}
.t-minimal h1{font-size:34px;margin-top:14px}
.t-minimal .acoes{justify-content:flex-start}
.t-minimal .prods{gap:0}
.t-minimal .prod{background:transparent;border-radius:0;padding:14px 0;border-bottom:1px solid var(--linha)}
.t-minimal .btn{background:transparent;color:var(--texto);border:1.5px solid var(--texto);border-radius:4px}
.t-minimal .btn.destaque{background:var(--texto);color:var(--fundo);box-shadow:none}
.t-minimal .avaliar{border-radius:6px}
/* Acabamento: profundidade, transições suaves e movimento */
:root{--ease:cubic-bezier(.2,.7,.2,1);--sombra:0 1px 2px rgba(0,0,0,.04),0 12px 28px -12px color-mix(in srgb,var(--texto) 30%,transparent)}
body{background:radial-gradient(90% 420px at 50% -80px,color-mix(in srgb,var(--cor) 22%,transparent),transparent 70%),var(--fundo)}
h1{letter-spacing:-.02em}
.capa{position:relative;overflow:hidden;height:170px}
.capa::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,var(--fundo) 100%)}
.logo{box-shadow:0 0 0 6px color-mix(in srgb,var(--cor) 16%,transparent),0 16px 32px -12px color-mix(in srgb,var(--cor) 70%,transparent);transition:transform .6s var(--ease)}
.logo:hover{transform:scale(1.05) rotate(-2deg)}
.chips a,.acao .ic,.add,.step button,.x{transition:background .3s,color .3s,transform .35s var(--ease),box-shadow .35s var(--ease)}
.chips a:hover{transform:translateY(-1px);background:var(--suave)}
.acao .ic{box-shadow:var(--sombra)}
.acao:hover .ic{transform:translateY(-3px);box-shadow:0 14px 26px -10px color-mix(in srgb,var(--cor) 70%,transparent)}
.prod{transition:transform .5s var(--ease),box-shadow .5s var(--ease),background .3s}
.prod:hover{transform:translateY(-3px);box-shadow:var(--sombra)}
.pimg{transition:transform .9s var(--ease)}
.t-vitrine .prod:hover .pimg{transform:scale(1.07)}
.add:hover{box-shadow:0 8px 18px -6px color-mix(in srgb,var(--cor) 80%,transparent)}
.add:active,.step button:active{transform:scale(.88)}
.btn,.avaliar{transition:transform .4s var(--ease),box-shadow .4s var(--ease),filter .3s}
.btn:hover,.avaliar:hover{transform:translateY(-2px);filter:brightness(1.06)}
.btn:active,.avaliar:active{transform:scale(.98)}
.btn.destaque{box-shadow:0 14px 30px -10px color-mix(in srgb,var(--cor) 65%,transparent)}
.cartbar{background:color-mix(in srgb,var(--cor) 93%,transparent);-webkit-backdrop-filter:blur(14px) saturate(1.4);backdrop-filter:blur(14px) saturate(1.4);transition:transform .5s var(--ease),background .3s}
.cartbar:not([hidden]){animation:cartSobe .7s var(--ease) both}
.cartbar:active{transform:translateX(-50%) scale(.98)}
@keyframes cartSobe{from{opacity:0;translate:0 30px}to{opacity:1;translate:0 0}}
dialog[open]{animation:dialogSobe .55s var(--ease) both}
dialog[open]::backdrop{animation:dialogFade .4s ease both;backdrop-filter:blur(3px)}
@keyframes dialogSobe{from{opacity:0;translate:0 40px}to{opacity:1;translate:0 0}}
@keyframes dialogFade{from{opacity:0}to{opacity:1}}
@keyframes entra{from{opacity:0;translate:0 18px;filter:blur(6px)}to{opacity:1;translate:0 0;filter:blur(0)}}
.topo>*{animation:entra 1s var(--ease) both}
.topo>*:nth-child(2){animation-delay:.08s}.topo>*:nth-child(3){animation-delay:.16s}.topo>*:nth-child(4){animation-delay:.24s}.topo>*:nth-child(5){animation-delay:.32s}
.links .btn{animation:entra .9s var(--ease) both}
.links .btn:nth-child(2){animation-delay:.1s}.links .btn:nth-child(3){animation-delay:.2s}.links .btn:nth-child(4){animation-delay:.3s}
@supports (animation-timeline:view()){
  .cat h2,.bloco,.avaliar,.infos{animation:entra linear both;animation-timeline:view();animation-range:entry 0% entry 40%}
  .prod{animation:entra linear both;animation-timeline:view();animation-range:entry 0% entry 55%}
}
.t-minimal .prod:hover{box-shadow:none;transform:translateX(4px)}
.t-minimal .btn:hover,.t-minimal .avaliar:hover{box-shadow:none}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
/* Agendamento de serviços */
.ag-op{display:grid;gap:2px;width:100%;text-align:left;padding:13px 14px;border:1px solid var(--linha);border-radius:12px;background:var(--fundo);color:inherit;font:inherit;cursor:pointer;transition:background .3s,transform .35s var(--ease),box-shadow .35s var(--ease)}
.ag-op:hover{background:var(--suave);transform:translateY(-2px);box-shadow:var(--sombra)}
.ag-op small{opacity:.7;font-size:13px}
a.ag-op{text-decoration:none}
.erro .ag-op{margin-top:8px;color:var(--texto);font-weight:600}
.ag-steps{display:grid;gap:12px}
.ag-op[hidden]{display:none!important}
.ag-busca{font:inherit;font-size:16px;width:100%;padding:11px 14px;border:1px solid var(--linha);border-radius:12px;background:var(--suave);color:var(--texto)}
.ag-par{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ag-chips{display:flex;flex-wrap:wrap;gap:8px}
.ag-chips button{border:1px solid var(--linha);background:var(--fundo);color:inherit;border-radius:999px;padding:8px 14px;font:inherit;font-size:14px;cursor:pointer;transition:background .3s,color .3s,transform .3s var(--ease)}
.ag-chips button:hover{transform:translateY(-1px)}
.ag-chips button[aria-pressed=true]{background:var(--acento);color:var(--sobre-acento);border-color:var(--acento)}
.ag-voltar{justify-self:start;background:none;border:0;padding:0;color:inherit;opacity:.7;font:inherit;cursor:pointer}
.ag-sub{margin:4px 0 0;font-weight:700;font-size:14px}
/* Serviços com fotos e vídeos */
.svc-lista{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.barbeiros{margin-top:14px}.barbs{display:flex;flex-wrap:wrap;gap:8px}
.barb{display:inline-flex;align-items:center;gap:8px;padding:4px 14px 4px 4px;background:var(--suave);border:1px solid var(--linha);border-radius:999px;color:var(--texto);font:inherit;cursor:pointer;transition:transform .3s var(--ease),box-shadow .3s var(--ease)}
.barb:hover{transform:translateY(-2px);box-shadow:0 10px 24px -14px var(--cor)}
.barb-foto{width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--cor);color:var(--sobre);display:flex;align-items:center;justify-content:center;font:800 13px/1 var(--fb)}
.barb-foto img{width:100%;height:100%;object-fit:cover;display:block}
.barb b{font-size:14px}
.svc{margin:0;min-width:0;background:var(--suave);border:1px solid var(--linha);border-radius:14px;overflow:hidden;transition:transform .4s var(--ease),box-shadow .4s var(--ease)}
.svc:hover{transform:translateY(-3px);box-shadow:var(--sombra)}
.svc-midia{aspect-ratio:4/5;background:var(--linha)}
.svc-midia img,.svc-midia video{width:100%;height:100%;object-fit:cover;display:block}
.svc-t{display:grid;gap:2px;padding:10px 12px}
.svc-t b{overflow-wrap:break-word}
.svc-t small{opacity:.7;font-size:13px}
.svc-mais{display:flex;gap:6px;padding:0 10px 10px;overflow-x:auto}
.svc-mais img,.svc-mais video{width:56px;height:56px;object-fit:cover;border-radius:8px;flex:none}
.svc[data-agendar]{cursor:pointer}.svc-ag{margin-top:4px;color:var(--acento);font-weight:700;font-size:14px}
.svc-vazio{display:grid;place-items:center;background:linear-gradient(160deg,var(--suave),var(--linha));color:var(--acento)}
.svc-vazio svg{width:30%;height:auto;opacity:.6}
.svc-lista.compacta{grid-template-columns:1fr;gap:8px}
.compacta .svc{display:flex;align-items:center;gap:12px;padding:8px;container-type:inline-size}
.compacta .svc-midia{flex:none;width:56px;height:56px;aspect-ratio:auto;border-radius:10px;overflow:hidden}
.compacta .svc-vazio svg{width:50%}
.compacta .svc-t{flex:1;min-width:0;padding:0 6px 0 0}
.compacta .svc-ag{margin:2px 0 0}
@container (min-width:280px){.compacta .svc-t{grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:10px}.compacta .svc-t b,.compacta .svc-t small{grid-column:1}.compacta .svc-ag{grid-column:2;grid-row:1/span 2;margin:0}}
@media (min-width:640px){.svc-lista{grid-template-columns:repeat(3,minmax(0,1fr))}.svc-lista.compacta{grid-template-columns:repeat(2,minmax(0,1fr))}}
.protese{border:2px solid var(--acento);border-radius:16px;padding:16px;background:color-mix(in srgb,var(--acento) 8%,transparent)}
.protese h2{margin-top:0}
.protese-sub{margin:-4px 0 12px;opacity:.85;font-size:15px}
.sinal-box{border:2px solid var(--acento);border-radius:14px;padding:14px;display:grid;gap:6px;justify-items:center;text-align:center;margin:10px 0}
.sinal-box small{opacity:.85}
.sinal-qr svg{display:block;width:184px;height:184px;background:#fff;padding:8px;border-radius:10px}
/* Clube de assinatura */
.clube-sub{margin:-4px 0 12px;opacity:.75;font-size:14px}
.planos{display:grid;gap:12px}
.plano{display:grid;gap:6px;padding:16px;background:var(--suave);border:1px solid var(--linha);border-radius:14px}
.plano h3{margin:0;font:700 17px/1.25 var(--ft)}
.plano-preco{font:800 26px/1.1 var(--fb);font-variant-numeric:tabular-nums}.plano-preco small{font-size:14px;font-weight:600;opacity:.7}
.plano p{margin:0;font-size:14px;opacity:.85}.plano .plano-regras{font-size:13px;opacity:.7}
.plano-ag{justify-self:start;margin-top:6px;font:inherit;font-weight:700;padding:10px 18px;border-radius:999px;border:0;background:var(--cor);color:var(--sobre);cursor:pointer;transition:transform .3s var(--ease)}
.plano-ag:hover{transform:translateY(-2px)}
.campos .check{display:flex;align-items:center;gap:10px;cursor:pointer}
.campos .check input[type=checkbox]{width:20px;height:20px;padding:0;margin:0;flex:none;accent-color:var(--acento)}
.campos .check small{display:block;opacity:.7;font-size:12px}
@media (min-width:640px){.planos{grid-template-columns:repeat(2,minmax(0,1fr))}}
/* App na tela do celular (v12) e confirmação de presença */
.app-rodape{text-align:center;margin:20px 0 0}
.app-rodape [hidden]{display:none}
.app-link{display:inline-flex;align-items:center;gap:8px;background:var(--suave);border:1px solid var(--linha);color:inherit;border-radius:999px;padding:10px 16px;font:600 13px var(--fb);cursor:pointer}
.app-link svg{width:17px;height:17px}
.app-faixa{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:30;max-width:536px;margin:0 auto;display:grid;grid-template-columns:44px minmax(0,1fr);column-gap:12px;row-gap:10px;align-items:center;padding:14px;border-radius:18px;background:var(--fundo);color:var(--texto);border:1px solid var(--linha);box-shadow:0 18px 40px -12px rgba(0,0,0,.55);animation:cartSobe .5s var(--ease) both}
.app-faixa.app-avisos{top:calc(12px + env(safe-area-inset-top,0px));bottom:auto}
body.tem-cat .app-faixa:not(.app-avisos){bottom:calc(88px + env(safe-area-inset-bottom,0px))}
.app-faixa img{width:44px;height:44px;border-radius:11px}
.app-faixa .t{line-height:1.3}
.app-faixa .t b{display:block;font-size:15px}
.app-faixa .t small{display:block;font-size:12.5px;opacity:.75}
.app-faixa .bts{grid-column:2;display:flex;align-items:center;gap:6px}
.app-faixa .sim{background:var(--acento);color:var(--sobre-acento);border:0;border-radius:999px;padding:9px 16px;font:700 13px var(--fb);cursor:pointer}
.app-faixa .nao{background:none;border:0;color:inherit;opacity:.7;font:600 13px var(--fb);padding:9px 8px;cursor:pointer}
.app-icone{display:flex;align-items:center;gap:12px}
.app-icone img{width:56px;height:56px;border-radius:14px;flex:none}
.app-icone b{display:block;font-size:16px}.app-icone small{opacity:.7;font-size:13px}
.app-passos{margin:0;padding:0;list-style:none;display:grid;gap:14px;counter-reset:passo}
.app-passos li{display:flex;gap:12px;align-items:flex-start;counter-increment:passo;line-height:1.45}
.app-passos li::before{content:counter(passo);flex:none;width:28px;height:28px;border-radius:50%;background:var(--acento);color:var(--sobre-acento);display:grid;place-items:center;font-weight:700;font-size:14px}
.app-passos svg{width:18px;height:18px;vertical-align:-3px}
.ag-op.destaque{background:var(--acento);color:var(--sobre-acento);border-color:transparent}
.ag-op.destaque small{opacity:.85}
.ag-op.perigo{border-color:#c0392b;color:#c0392b}
.ag-ok{font-weight:600;margin:0}
.ag-dica{font-weight:400;font-size:12.5px;opacity:.75}
.demo-faixa{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:center;padding:9px 14px;background:var(--acento);color:var(--sobre-acento);font:600 13px/1.4 var(--fb);text-align:center}
.demo-faixa a{color:inherit;text-decoration:underline;white-space:nowrap}
`;
}

module.exports = { bioEstilos };
