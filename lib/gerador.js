/* Gerador dos mini sites: usado pelo Criador de Bio (navegador) e pela Vercel (api/*.js).
   Mantenha este arquivo igual nos dois lugares: o Criador grava uma cópia em lib/gerador.js a cada publicação. */
(function(root){
const FONTS = {
  "Poppins":"Poppins:wght@400;600;700",
  "Montserrat":"Montserrat:wght@400;600;800",
  "Playfair Display":"Playfair+Display:wght@500;700",
  "Lora":"Lora:wght@400;600",
  "Nunito":"Nunito:wght@400;600;800",
  "DM Sans":"DM+Sans:wght@400;600;700",
  "Bebas Neue":"Bebas+Neue",
  "Pacifico":"Pacifico",
  "Oswald":"Oswald:wght@400;600"
};
const PEDIDO_PADRAO = {entrega:true, retirada:true, agendamento:false, taxa:"", minimo:"", pag:["Pix","Cartão","Dinheiro"], pix:"", botao:"Enviar pedido pelo WhatsApp", obsDica:"Ex.: sem cebola, troco para 50"};
var esc = t => String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
var safeUrl = u => /^(https?:|data:image\/)/i.test(u||"") ? u : "";
var safeImg = u => /^(https?:|data:image\/|\/img\/)/i.test(u||"") ? u : "";
function num(v){let t=String(v==null?"":v).replace(/[^\d,.]/g,"");if(!t)return NaN;if(t.indexOf(",")>-1)t=t.replace(/\./g,"").replace(",",".");return parseFloat(t)}
function brl(n){return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
function sobre(hex){const h=(hex||"#000").replace("#","");const r=parseInt(h.substr(0,2),16),g=parseInt(h.substr(2,2),16),b=parseInt(h.substr(4,2),16);const L=(0.299*r+0.587*g+0.114*b)/255;return L>0.62?"#161616":"#ffffff"}

/* ---------- Ícones ---------- */
const ICON = {
  star:'<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
  whats:'<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm0 1.8a7.2 7.2 0 1 1-3.7 13.4l-.3-.2-2.5.7.7-2.4-.2-.3A7.2 7.2 0 0 1 12 4.8zm-2.6 3.6c-.2 0-.5 0-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.8 2.1.8 2.6.7 3 .6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.3-1.6-.8c-.2-.1-.4-.1-.6.1l-.7.9c-.1.2-.3.2-.5.1-.2-.1-1-.4-1.9-1.2-.7-.6-1.2-1.4-1.3-1.6-.1-.2 0-.4.1-.5l.4-.5.3-.4v-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4z"/>',
  insta:'<path d="M7.5 3h9A4.5 4.5 0 0 1 21 7.5v9a4.5 4.5 0 0 1-4.5 4.5h-9A4.5 4.5 0 0 1 3 16.5v-9A4.5 4.5 0 0 1 7.5 3zm0 1.8A2.7 2.7 0 0 0 4.8 7.5v9a2.7 2.7 0 0 0 2.7 2.7h9a2.7 2.7 0 0 0 2.7-2.7v-9a2.7 2.7 0 0 0-2.7-2.7zM12 7.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zm0 1.8a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2zm4.7-2.3a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>',
  pin:'<path d="M12 2.5a7 7 0 0 0-7 7c0 5.1 7 12 7 12s7-6.9 7-12a7 7 0 0 0-7-7zm0 4.3a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z"/>',
  link:'<path d="M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0zM8.2 18.6a3.6 3.6 0 0 1-2.6-6.1l2.1-2.1a1 1 0 1 1 1.4 1.4L7 13.9a1.6 1.6 0 0 0 2.3 2.3l2.1-2.1a1 1 0 1 1 1.4 1.4l-2.1 2.1a3.6 3.6 0 0 1-2.5 1zm8.1-5.6a1 1 0 0 1-.7-1.7l2.1-2.1a1.6 1.6 0 0 0-2.3-2.3l-2.1 2.1a1 1 0 1 1-1.4-1.4L14 5.5a3.6 3.6 0 0 1 5.1 5.1L17 12.7a1 1 0 0 1-.7.3z"/>',
  bag:'<path d="M7 7V6a5 5 0 0 1 10 0v1h2.2a1 1 0 0 1 1 .9l1.1 12a1.9 1.9 0 0 1-1.9 2.1H4.6a1.9 1.9 0 0 1-1.9-2.1l1.1-12a1 1 0 0 1 1-.9zm1.8 0h6.4V6a3.2 3.2 0 0 0-6.4 0z"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICON[k]}</svg>`;

/* ---------- Script que roda dentro do site publicado (carrinho + pedido) ---------- */
function bioRuntime(){
  var C=JSON.parse(document.getElementById("bio-config").textContent);
  var P={};(C.produtos||[]).forEach(function(p){P[p.id]=p});
  var O=C.pedido||{};
  var K="carrinho-"+(C.slug||"site"),cart={};
  try{cart=JSON.parse(localStorage.getItem(K))||{}}catch(e){}
  for(var k in cart){if(!P[k]||P[k].esgotado)delete cart[k]}
  var dlg=document.getElementById("cart");
  function $(id){return document.getElementById(id)}
  function num(v){var t=String(v==null?"":v).replace(/[^\d,.]/g,"");if(!t)return NaN;if(t.indexOf(",")>-1)t=t.replace(/\./g,"").replace(",",".");return parseFloat(t)}
  function brl(n){return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
  function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function save(){try{localStorage.setItem(K,JSON.stringify(cart))}catch(e){}}
  function qtd(){var q=0;for(var i in cart)q+=cart[i];return q}
  function subtotal(){var t=0;for(var i in cart){var pr=num(P[i].preco);if(!isNaN(pr))t+=pr*cart[i]}return t}
  function tipo(){var r=document.querySelector('input[name="tipo"]:checked');return r?r.value:(O.entrega?"entrega":(O.retirada?"retirada":""))}
  function taxa(){var t=num(O.taxa);return tipo()==="entrega"&&!isNaN(t)?t:0}
  function ctl(id){var q=cart[id]||0;if(!q)return '<button type="button" class="add" data-add="'+id+'" aria-label="Adicionar">+</button>';return '<span class="step"><button type="button" data-sub="'+id+'" aria-label="Tirar um">−</button><b>'+q+'</b><button type="button" data-add="'+id+'" aria-label="Mais um">+</button></span>'}
  function renderSheet(){
    var h="";for(var i in cart){var p=P[i],pr=num(p.preco);
      h+='<div class="it"><div class="it-n"><b>'+esc(p.nome)+'</b><small>'+(isNaN(pr)?"Preço a combinar":brl(pr*cart[i]))+'</small></div>'+ctl(i)+'</div>'}
    $("itens").innerHTML=h;
    var sub=subtotal(),tx=taxa(),t="";
    t+='<div><span>Subtotal</span><span>'+brl(sub)+'</span></div>';
    if(tipo()==="entrega")t+='<div><span>Entrega</span><span>'+(isNaN(num(O.taxa))?"a combinar":(tx?brl(tx):"grátis"))+'</span></div>';
    t+='<div class="final"><span>Total</span><span>'+brl(sub+tx)+'</span></div>';
    $("totais").innerHTML=t;
    var le=$("lEnd");if(le)le.hidden=tipo()!=="entrega";
  }
  function sync(){
    var els=document.querySelectorAll(".prods .ctl[data-id]");
    for(var j=0;j<els.length;j++){var id=els[j].getAttribute("data-id");if(!P[id])continue;
      els[j].innerHTML=P[id].esgotado?'<em class="esg">Esgotado</em>':ctl(id);
      var card=els[j].closest(".prod");if(card)card.classList.toggle("off",!!P[id].esgotado)}
    var q=qtd();$("cartbar").hidden=!q;$("cbQtd").textContent=q+(q>1?" itens":" item");$("cbTot").textContent=brl(subtotal());
    save();
    if(dlg.open){if(!q)dlg.close();else renderSheet()}
  }
  document.addEventListener("click",function(e){
    var a=e.target.closest("[data-add]"),r=e.target.closest("[data-sub]");
    if(a){var id=a.getAttribute("data-add");cart[id]=(cart[id]||0)+1;sync()}
    else if(r){var id2=r.getAttribute("data-sub");cart[id2]=(cart[id2]||0)-1;if(cart[id2]<=0)delete cart[id2];sync()}
    else if(e.target.closest("[data-close]")||e.target===dlg){dlg.close()}
  });
  // Preços sempre conforme os dados (o dono pode ter alterado pelo painel)
  var pe=document.querySelectorAll(".preco[data-pid]");
  for(var z=0;z<pe.length;z++){var pp=P[pe[z].getAttribute("data-pid")];if(pp){var nn=num(pp.preco);pe[z].textContent=isNaN(nn)?"Consultar":brl(nn)}}
  $("cartbar").addEventListener("click",function(){$("erro").textContent="";renderSheet();if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","")});
  document.addEventListener("change",function(e){if(e.target.name==="tipo")renderSheet()});
  $("enviar").addEventListener("click",function(){
    var nome=$("fNome").value.trim(),tp=tipo(),end=$("fEnd")?$("fEnd").value.trim():"",pag=$("fPag")?$("fPag").value:"",obs=$("fObs").value.trim(),quando=$("fQuando")?$("fQuando").value.trim():"";
    var sub=subtotal(),min=num(O.minimo),err="";
    if(!nome)err="Informe seu nome.";
    else if(O.agendamento&&!quando)err="Informe o dia e o horário que você prefere.";
    else if(tp==="entrega"&&!end)err="Informe o endereço de entrega.";
    else if(!isNaN(min)&&sub<min)err="O pedido mínimo é "+brl(min)+".";
    $("erro").textContent=err;if(err)return;
    var L=["*"+(O.agendamento?"Agendamento":"Pedido")+" pelo site - "+C.nome+"*",""];
    for(var i in cart){var p=P[i],pr=num(p.preco);L.push(cart[i]+"x "+p.nome+(isNaN(pr)?"":" — "+brl(pr*cart[i])))}
    L.push("");L.push("Subtotal: "+brl(sub));
    if(tp==="entrega")L.push("Entrega: "+(isNaN(num(O.taxa))?"a combinar":brl(taxa())));
    L.push("*Total: "+brl(sub+taxa())+"*");L.push("");
    L.push("Nome: "+nome);
    if(quando)L.push("Dia e horário: "+quando);
    if(tp)L.push(tp==="entrega"?"Entrega em: "+end:"Vou retirar no local");
    if(pag)L.push("Pagamento: "+pag);
    if(obs)L.push("Obs.: "+obs);
    var w=String(C.whatsapp||"").replace(/\D/g,"");if(w.indexOf("55")!==0)w="55"+w;
    var a=document.createElement("a");a.href="https://wa.me/"+w+"?text="+encodeURIComponent(L.join("\n"));a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
  });
  sync();
}

/* ---------- Gera o HTML do site ---------- */
function bigLinks(d){
  const L=[];
  if(d.review) L.push({k:"star",t:"Avalie a gente no Google",u:d.review,destaque:true});
  const w=waLink(d); if(w) L.push({k:"whats",t:"Fale no WhatsApp",u:w});
  const ig=igLink(d); if(ig) L.push({k:"insta",t:"Siga no Instagram",u:ig});
  if(d.maps) L.push({k:"pin",t:"Como chegar",u:d.maps});
  (d.extras||[]).forEach(e=>{if(e.titulo&&safeUrl(e.url))L.push({k:"link",t:e.titulo,u:e.url})});
  return L.filter(l=>safeUrl(l.u));
}
function waLink(d){const w=(d.whatsapp||"").replace(/\D/g,"");if(!w)return "";const n=w.startsWith("55")?w:"55"+w;return `https://wa.me/${n}${d.whatsMsg?"?text="+encodeURIComponent(d.whatsMsg):""}`}
function igLink(d){const ig=(d.instagram||"").replace(/^@/,"").replace(/https?:\/\/(www\.)?instagram\.com\//,"").replace(/\/.*/,"").trim();return ig?`https://instagram.com/${ig}`:""}
function configJSON(d){
  const c={};for(const k in d){if(!k.startsWith("_"))c[k]=d[k]}
  const strip=u=>String(u||"").startsWith("data:")?"":u;
  c.logo=strip(c.logo);c.capa=strip(c.capa);
  c.produtos=(c.produtos||[]).map(p=>({...p,foto:strip(p.foto)}));
  return JSON.stringify(c).replace(/</g,"\\u003c");
}
function bioHTML(d, img){
  img=img||(u=>u);
  const fT=d.fonteTitulo, fB=d.fonteTexto;
  const fam=[...new Set([fT,fB])].map(f=>"family="+FONTS[f]).join("&");
  const titulo=d.nome+(d.cidade?" | "+d.cidade:"");
  const desc=d.descricao||`${d.nome} em ${d.cidade}`;
  const logo=safeImg(img(d.logo)), capa=safeImg(img(d.capa));
  const iniciais=esc((d.nome||"?").split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join("").toUpperCase());
  const prods=(d.produtos||[]).filter(p=>p.nome);
  const temCat=prods.length>0;
  const O=d.pedido||PEDIDO_PADRAO;

  const notaTxt=(d.mostrarNota&&d.nota)?`${svg("star")}<b>${String(d.nota).replace(".",",")}</b>${d.totalAval?` · ${d.totalAval} avaliações`:""} no Google`:"";
  const nota=notaTxt?(d.review?`<a class="nota" href="${esc(d.review)}" target="_blank" rel="noopener">${notaTxt}</a>`:`<p class="nota">${notaTxt}</p>`):"";

  const acoesList=[];
  const w=waLink(d); if(w) acoesList.push(["whats","WhatsApp",w]);
  const ig=igLink(d); if(ig) acoesList.push(["insta","Instagram",ig]);
  if(safeUrl(d.review)) acoesList.push(["star","Avaliar",d.review]);
  if(safeUrl(d.maps)) acoesList.push(["pin","Como chegar",d.maps]);
  const acoes=acoesList.length?`<nav class="acoes" aria-label="Contato">${acoesList.map(a=>`<a class="acao" href="${esc(a[2])}" target="_blank" rel="noopener"><span class="ic">${svg(a[0])}</span><small>${a[1]}</small></a>`).join("")}</nav>`:"";

  // Catálogo agrupado na ordem das categorias; sem categoria vai para "Outros"
  const ordem=(d.categorias||[]);
  const grupos=ordem.map(c=>({nome:c,itens:prods.filter(p=>(p.cat||"").trim()===c)})).filter(g=>g.itens.length);
  const soltos=prods.filter(p=>!ordem.includes((p.cat||"").trim()));
  if(soltos.length) grupos.push({nome:grupos.length?"Outros":(d.catalogoTitulo||"Produtos"),itens:soltos});
  const chips=grupos.length>1?`<nav class="chips" aria-label="Categorias">${grupos.map((g,i)=>`<a href="#cat-${i}">${esc(g.nome)}</a>`).join("")}</nav>`:"";
  const card=p=>{const f=safeImg(img(p.foto));const pr=num(p.preco);return `<article class="prod${p.esgotado?" off":""}">
${f?`<img class="pimg" src="${esc(f)}" alt="${esc(p.nome)}" loading="lazy">`:""}<div class="pinfo"><h3>${esc(p.nome)}</h3>${p.desc?`<p>${esc(p.desc)}</p>`:""}
<div class="prow"><b class="preco" data-pid="${esc(p.id)}">${isNaN(pr)?"Consultar":brl(pr)}</b><span class="ctl" data-id="${esc(p.id)}">${p.esgotado?`<em class="esg">Esgotado</em>`:`<button type="button" class="add" data-add="${esc(p.id)}" aria-label="Adicionar ${esc(p.nome)}">+</button>`}</span></div></div></article>`};
  const catalogo=temCat?`<section class="catalogo">${grupos.length>1?"":`<h2 class="sec">${esc(d.catalogoTitulo||"Produtos")}</h2>`}${chips}
${grupos.map((g,i)=>`<section class="cat" id="cat-${i}">${grupos.length>1?`<h2>${esc(g.nome)}</h2>`:""}<div class="prods">${g.itens.map(card).join("")}</div></section>`).join("")}</section>`:"";

  const extras=(d.extras||[]).filter(e=>e.titulo&&safeUrl(e.url));
  const mais=temCat&&extras.length?`<section class="mais bloco"><h2>Links</h2>${extras.map(e=>`<a href="${esc(e.url)}" target="_blank" rel="noopener">${svg("link")}<span>${esc(e.titulo)}</span><em aria-hidden="true">→</em></a>`).join("")}</section>`:"";
  const avaliar=temCat&&safeUrl(d.review)?`<a class="avaliar" href="${esc(d.review)}" target="_blank" rel="noopener">${svg("star")}<span>Gostou? Avalie a gente no Google<small>Leva menos de 1 minuto</small></span></a>`:"";
  const links=!temCat?`<nav class="links">${bigLinks(d).map(l=>`<a class="btn${l.destaque?" destaque":""}" href="${esc(l.u)}" target="_blank" rel="noopener">${svg(l.k)}<span>${esc(l.t)}</span><em aria-hidden="true">→</em></a>`).join("")}</nav>`:"";
  const horario=d.horario?`<details class="info"><summary>Horário de funcionamento</summary><p>${esc(d.horario).replace(/\n/g,"<br>")}</p></details>`:"";
  const endereco=d.endereco?`<p class="end">${svg("pin")}<span>${esc(d.endereco)}</span></p>`:"";
  const infoBloco=(horario||endereco)?`<section class="bloco infos">${horario}${endereco}</section>`:"";

  const pags=(O.pag||[]);
  const ag=!!O.agendamento;
  const sheet=temCat?`<button type="button" class="cartbar" id="cartbar" hidden>${svg("bag")}<span id="cbQtd"></span><b>${ag?"Continuar agendamento":"Ver pedido"}</b><span id="cbTot"></span></button>
<dialog id="cart" aria-labelledby="ctitle"><div class="sheet">
<div class="sh-top"><h2 id="ctitle">${ag?"Seu agendamento":"Seu pedido"}</h2><button type="button" class="x" data-close aria-label="Fechar">×</button></div>
<div id="itens"></div>
<div class="campos">
<label>Seu nome<input id="fNome" autocomplete="name"></label>
${ag?`<label>Dia e horário que você prefere<input id="fQuando" placeholder="Ex.: sábado, às 10h"></label>`:""}
${O.entrega&&O.retirada?`<div class="tipos" role="radiogroup" aria-label="Como receber"><label><input type="radio" name="tipo" value="entrega" checked> Entrega</label><label><input type="radio" name="tipo" value="retirada"> Retirar no local</label></div>`:""}
${O.entrega?`<label id="lEnd">Endereço de entrega<textarea id="fEnd" rows="2" autocomplete="street-address" placeholder="Rua, número, bairro e ponto de referência"></textarea></label>`:""}
${pags.length?`<label>Pagamento<select id="fPag">${pags.map(p=>`<option>${esc(p)}</option>`).join("")}</select></label>`:""}
${O.pix?`<p class="pix">Chave Pix: <b>${esc(O.pix)}</b></p>`:""}
<label>Observação<textarea id="fObs" rows="2" placeholder="${esc(O.obsDica||"")}"></textarea></label>
</div>
<div class="tot" id="totais"></div>
<p class="erro" id="erro" role="alert"></p>
<button type="button" class="enviar" id="enviar">${svg("whats")}<span>${esc(O.botao||PEDIDO_PADRAO.botao)}</span></button>
</div></dialog>`:"";

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(d.cor)}">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fam}&display=swap">
<style>
:root{--cor:${d.cor};--sobre:${sobre(d.cor)};--fundo:${d.fundo};--texto:${d.texto};--ft:"${fT}",Georgia,serif;--fb:"${fB}",system-ui,sans-serif;
--linha:color-mix(in srgb,var(--texto) 14%,transparent);--suave:color-mix(in srgb,var(--texto) 6%,var(--fundo))}
*{box-sizing:border-box}html,body{margin:0}
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
.acao .ic{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:var(--suave);color:var(--cor);border:1px solid var(--linha)}
.sec{font:700 22px var(--ft);margin:26px 0 12px}
.chips{position:sticky;top:0;z-index:5;display:flex;gap:8px;overflow-x:auto;padding:12px 16px;margin:18px -16px 0;background:var(--fundo);scrollbar-width:none;border-bottom:1px solid var(--linha)}
.chips::-webkit-scrollbar{display:none}
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
</style>
<script type="application/json" id="bio-config">${configJSON(d)}<\/script>
</head>
<body class="t-${esc(d.modelo)}${temCat?" tem-cat":""}"><div class="pg">
${d.modelo==="vitrine"?`<div class="capa"${capa?` style="background-image:url('${esc(capa)}')"`:""}></div>`:""}
<header class="topo">
${logo?`<img class="logo" src="${esc(logo)}" alt="Logo ${esc(d.nome)}">`:`<div class="logo" aria-hidden="true">${iniciais}</div>`}
<h1>${esc(d.nome)}</h1>
${d.descricao?`<p class="sub">${esc(d.descricao)}</p>`:""}
${nota}
${temCat?acoes:""}
</header>
${links}
${catalogo}
${avaliar}
${mais}
${infoBloco}
<footer>${esc(d.nome)}${d.cidade?" · "+esc(d.cidade):""}</footer>
</div>
${sheet}
${temCat?`<script>(${bioRuntime.toString()})()<\/script>`:""}
</body></html>`;
}
function redirectHTML(url){
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(url)}"><title>Avaliar no Google</title><script>location.replace(${JSON.stringify(url)})<\/script></head><body><p><a href="${esc(url)}">Abrir avaliação no Google</a></p></body></html>`;
}


var Gerador={VERSAO:2,FONTS:FONTS,PEDIDO_PADRAO:PEDIDO_PADRAO,esc:esc,safeUrl:safeUrl,safeImg:safeImg,num:num,brl:brl,sobre:sobre,bioHTML:bioHTML,redirectHTML:redirectHTML,configJSON:configJSON};
if(typeof module!=="undefined"&&module.exports) module.exports=Gerador; else root.Gerador=Gerador;
})(typeof self!=="undefined"?self:this);
