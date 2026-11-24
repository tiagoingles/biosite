/* Gerador dos mini sites: usado pelo Criador de Bio (navegador) e pela Vercel (api/*.js).
   Mantenha este arquivo igual nos dois lugares: o Criador grava uma cópia em lib/gerador.js a cada publicação. */
(function(root){
// Partes do site em arquivos próprios (o Criador recebe cópias delas: scripts/sincronizar-criador.js)
const { bioRuntime } = require("./gerador-pedido");
const { agendaRuntime } = require("./gerador-agenda");
const { appRuntime } = require("./gerador-app");
const { bioEstilos } = require("./gerador-estilos");
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
const PEDIDO_PADRAO = {entrega:true, retirada:true, agendamento:false, taxa:"", minimo:"", pag:["Pix","Cartão","Dinheiro"], pix:"", bairros:[], botao:"Enviar pedido pelo WhatsApp", obsDica:"Ex.: sem cebola, troco para 50"};
var esc = t => String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
var safeUrl = u => /^(https?:|data:image\/)/i.test(u||"") ? u : "";
var safeImg = u => /^(https?:|data:image\/|\/img\/)/i.test(u||"") ? u : "";
function num(v){let t=String(v==null?"":v).replace(/[^\d,.]/g,"");if(!t)return NaN;if(t.indexOf(",")>-1)t=t.replace(/\./g,"").replace(",",".");return parseFloat(t)}
function brl(n){return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
// Preço do serviço como o cliente lê: "A partir de 28,00" -> "a partir de R$ 28,00"; texto sem número fica como está
function precoTxt(p){const n=num(p);if(p==null||p==="")return "";return isNaN(n)?String(p):(/^\s*a partir de/i.test(String(p))?"a partir de ":"")+brl(n)}
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
// App da barbearia no celular do cliente (gerador v12): faixa para colocar o site na tela do celular (com o
// ícone da barbearia), passo a passo no iPhone e no navegador do Instagram, e os avisos no celular (lembrete,
// confirmação, mudança de horário e novidades). Só entra no site que tem os ícones (o Criador gera na publicação).

// Nome curto do ícone na tela do celular (cabe uns 12 caracteres): tira "Barbearia", "Barber"...
function nomeCurto(nome){
  var n=String(nome||"").trim().replace(/\s+/g," ");
  if(n.length<=12)return n;
  var sem=n.replace(/\b(barbearia|barbershop|barber shop|barber|sal[aã]o|studio|est[uú]dio)\b/gi," ").replace(/\s+/g," ").trim().replace(/^(d[oae]s?|&|e)\s+/i,"").trim();
  if(sem&&sem.length<=12)return sem;
  var base=sem||n,out="";
  base.split(" ").every(function(p){var t=out?out+" "+p:p;if(t.length>12)return false;out=t;return true});
  out=out.replace(/\s+(d[oae]s?|e|&)$/i,"");
  return out||base.slice(0,12);
}

// Manifesto do app (/<slug>.webmanifest): nome, cores, ícones e o atalho "Agendar horário"
function manifestJSON(d){
  var ic=d.icones||{},s="/"+d.slug,icons=[];
  if(ic.i192)icons.push({src:ic.i192,sizes:"192x192",type:"image/png",purpose:"any"});
  if(ic.i512){icons.push({src:ic.i512,sizes:"512x512",type:"image/png",purpose:"any"});icons.push({src:ic.i512,sizes:"512x512",type:"image/png",purpose:"maskable"})}
  var m={id:s,name:d.nome,short_name:nomeCurto(d.nome),description:d.descricao||(d.nome+(d.cidade?" em "+d.cidade:"")),lang:"pt-BR",dir:"ltr",start_url:s+"?app=1",scope:s,display:"standalone",background_color:d.fundo||"#ffffff",theme_color:d.cor||"#111111",icons:icons};
  var AG=(d.tipo==="barbearia"&&d.agenda)||{};
  if(AG.ativo)m.shortcuts=[{name:"Agendar horário",short_name:"Agendar",url:s+"?agendar=1",icons:ic.i192?[{src:ic.i192,sizes:"192x192",type:"image/png"}]:[]}];
  return JSON.stringify(m,null,2)+"\n";
}

// Ícone do app (só no navegador, no Criador): o logo num círculo (como no topo do site) sobre a cor de fundo.
// fracao: diâmetro do círculo (0,8 cabe na área segura do ícone adaptável do Android).
function desenharIcone(d,t,img,fracao){
  var c=document.createElement("canvas");c.width=c.height=t;
  var x=c.getContext("2d"),r=t*fracao/2,m=t/2;
  x.fillStyle=d.fundo||"#111111";x.fillRect(0,0,t,t);
  x.save();x.beginPath();x.arc(m,m,r,0,Math.PI*2);x.closePath();x.clip();
  x.fillStyle=d.cor||"#333333";x.fillRect(m-r,m-r,2*r,2*r);
  if(img){
    if(/\.svg(\?|$)|^data:image\/svg/i.test(img.src||""))x.drawImage(img,m-r,m-r,2*r,2*r);
    else{var w=img.naturalWidth||img.width||1,h=img.naturalHeight||img.height||1,k=Math.max(2*r/w,2*r/h);x.drawImage(img,m-w*k/2,m-h*k/2,w*k,h*k)}
  }else{
    var ini=String(d.nome||"?").split(/\s+/).filter(Boolean).slice(0,2).map(function(p){return p[0]}).join("").toUpperCase();
    x.fillStyle=sobre(d.cor);x.font="700 "+Math.round(r*(ini.length>1?0.78:0.95))+"px \""+String(d.fonteTitulo||"Georgia").replace(/"/g,"")+"\",Georgia,serif";
    x.textAlign="center";x.textBaseline="middle";x.fillText(ini,m,m+r*0.05);
  }
  x.restore();
  return c.toDataURL("image/png");
}

function bioHTML(d, img){
  img=img||(u=>u);
  const fT=d.fonteTitulo, fB=d.fonteTexto;
  const fam=[...new Set([fT,fB])].map(f=>"family="+FONTS[f]).join("&");
  const titulo=d.nome+(d.cidade?" | "+d.cidade:"");
  const desc=d.descricao||`${d.nome} em ${d.cidade}`;
  const logo=safeImg(img(d.logo)), capa=safeImg(img(d.capa));
  const iniciais=esc((d.nome||"?").split(/\s+/).filter(Boolean).slice(0,2).map(p=>p[0]).join("").toUpperCase());
  const O=d.pedido||PEDIDO_PADRAO;
  // Destaque legível: se a cor da marca some no fundo (ex.: preto no preto), textos e ícones de destaque usam a cor do texto
  const lumi=h=>{let x=String(h||"").replace("#","");if(x.length===3)x=x.replace(/./g,"$&$&");if(!/^[0-9a-f]{6}$/i.test(x))return null;const c=[0,2,4].map(i=>{const v=parseInt(x.substr(i,2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)});return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]};
  const lCor=lumi(d.cor),lFundo=lumi(d.fundo);
  const acento=lCor!==null&&lFundo!==null&&(Math.max(lCor,lFundo)+0.05)/(Math.min(lCor,lFundo)+0.05)<2.5?d.texto:d.cor;
  // Agendamento de serviços: o cliente escolhe serviço, profissional e horário, e envia pelo WhatsApp.
  // Com agendamento, os serviços são a vitrine: sem catálogo de produtos e sem carrinho.
  const AG=(d.tipo==="barbearia"&&d.agenda)||{};
  const agOk=!!AG.ativo&&(AG.servicos||[]).length>0&&(AG.profissionais||[]).length>0;
  const prods=agOk?[]:(d.produtos||[]).filter(p=>p.nome);
  const temCat=prods.length>0;
  const agCta=agOk?`<nav class="links"><button type="button" class="btn destaque" id="abrirAgenda">${svg("whats")}<span>${esc(AG.botao||"Agendar um horário")}</span><em aria-hidden="true">→</em></button></nav>`:"";
  // Painel de barbeiros, logo abaixo do botão de agendamento: foto (ou iniciais). O JS preenche a lista.
  const barbBloco=agOk?`<section class="barbeiros" id="barbeiros" hidden><div class="barbs" id="barbsLista"></div></section>`:"";
  // Seção de serviços: cada serviço mostra as fotos e vídeos cadastrados para ele.
  // Serviço sem foto ganha um ícone (nunca um quadro vazio); se a maioria não tem foto, a seção vira lista de preços.
  const svcs=agOk?(AG.servicos||[]):[];
  const svcMidia=v=>(v.midia||[]).filter(x=>safeUrl(x.url));
  const compactaDe=l=>l.filter(v=>svcMidia(v).length).length*2<l.length;
  const svcVazio=`<div class="svc-midia svc-vazio" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></svg></div>`;
  const cartoesSvc=(lista,compacta)=>lista.map(v=>{const m=svcMidia(v);const preco=precoTxt(v.preco);const midia=x=>x.tipo==="video"?`<video src="${esc(x.url)}" muted autoplay loop playsinline disablepictureinpicture preload="metadata"></video>`:`<img src="${esc(x.url)}" alt="${esc(x.titulo||v.nome)}" loading="lazy">`;return `<article class="svc" data-agendar="${esc(v.id)}" role="button" tabindex="0" aria-label="Agendar ${esc(v.nome)}">${m[0]?`<div class="svc-midia">${midia(m[0])}</div>`:svcVazio}<div class="svc-t"><b>${esc(v.nome)}</b><small>${esc([v.duracao,preco].filter(Boolean).join(" · "))}</small><span class="svc-ag">Agendar →</span></div>${!compacta&&m.length>1?`<div class="svc-mais">${m.slice(1).map(midia).join("")}</div>`:""}</article>`}).join("");
  // Prótese capilar: seção própria e em destaque (pedido dos donos); os outros serviços ficam em "Serviços"
  const svcsNormais=svcs.filter(v=>!v.protese), svcsProtese=svcs.filter(v=>v.protese);
  const svcsBloco=agOk&&svcsNormais.length?`<section class="bloco svcs"><h2>Serviços</h2><div class="svc-lista${compactaDe(svcsNormais)?" compacta":""}">${cartoesSvc(svcsNormais,compactaDe(svcsNormais))}</div></section>`:"";
  const proteseBloco=agOk&&svcsProtese.length?`<section class="bloco svcs protese" id="protese"><h2>Prótese capilar</h2><p class="protese-sub">Aplicação e manutenção com hora marcada. Toque no serviço para agendar.</p><div class="svc-lista${compactaDe(svcsProtese)?" compacta":""}">${cartoesSvc(svcsProtese,compactaDe(svcsProtese))}</div></section>`:"";
  // Clube de assinatura: os planos vêm da API junto com a equipe; a seção aparece só quando há plano ativo
  const clubeBloco=agOk?`<section class="bloco clube" id="clube" hidden><h2>Clube de assinatura</h2><p class="clube-sub">Pague por mês e marque seus horários sem pagar a cada visita.</p><div class="planos" id="clubeLista"></div></section>`:"";
  const agDlg=agOk?`<dialog id="agenda" aria-labelledby="agTitulo"><div class="sheet"><div class="sh-top"><h2 id="agTitulo">Agendar</h2><button type="button" class="x" data-close aria-label="Fechar">×</button></div><div id="agSteps" class="ag-steps"></div><p class="erro" id="agErro" role="alert"></p><button type="button" class="enviar" id="agEnviar" hidden>${svg("whats")}<span>Enviar pedido pelo WhatsApp</span></button></div></dialog>`:"";

  const notaTxt=(d.mostrarNota&&d.nota)?`${svg("star")}<b>${String(d.nota).replace(".",",")}</b>${d.totalAval?` · ${d.totalAval} avaliações`:""} no Google`:"";
  const nota=notaTxt?(safeUrl(d.review)?`<a class="nota" href="${esc(d.review)}" target="_blank" rel="noopener">${notaTxt}</a>`:`<p class="nota">${notaTxt}</p>`):"";

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
  const busca=`<div class="busca"><input type="search" id="busca" placeholder="Buscar produto" aria-label="Buscar produto"><p class="busca-vazio" id="buscaVazia" hidden>Nenhum produto encontrado.</p></div>`;
  const chips=grupos.length>1?`<nav class="chips" aria-label="Categorias">${grupos.map((g,i)=>`<a href="#cat-${i}">${esc(g.nome)}</a>`).join("")}</nav>`:"";
  const card=p=>{const f=safeImg(img(p.foto));const pr=num(p.preco);return `<article class="prod${p.esgotado?" off":""}">
${f?`<img class="pimg" src="${esc(f)}" alt="${esc(p.nome)}" loading="lazy">`:""}<div class="pinfo"><h3>${esc(p.nome)}</h3>${(p.marca||p.unidade)?`<small class="pmeta">${esc([p.marca,p.unidade].filter(Boolean).join(" · "))}</small>`:""}${p.desc?`<p>${esc(p.desc)}</p>`:""}
<div class="prow"><b class="preco" data-pid="${esc(p.id)}">${isNaN(pr)?"Consultar":brl(pr)}</b><span class="ctl" data-id="${esc(p.id)}">${p.esgotado?`<em class="esg">Esgotado</em>`:`<button type="button" class="add" data-add="${esc(p.id)}" aria-label="Adicionar ${esc(p.nome)}">+</button>`}</span></div></div></article>`};
  const catalogo=temCat?`<section class="catalogo">${grupos.length>1?"":`<h2 class="sec">${esc(d.catalogoTitulo||"Produtos")}</h2>`}${busca}${chips}
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
  // Bairros cadastrados: lista de busca no pedido e aviso claro de onde se entrega
  const bairrosLista=((O.bairros)||[]).filter(b=>b&&b.nome).slice().sort((a,b)=>a.nome.localeCompare(b.nome,"pt-BR"));
  const bairrosTxt=bairrosLista.length?`<p class="cobertura"><b>Entregamos nestes bairros:</b> ${bairrosLista.map(b=>esc(b.nome)).join(", ")}. Fora desses bairros não entregamos.</p>`:"";
  const sheet=temCat?`<button type="button" class="cartbar" id="cartbar" hidden>${svg("bag")}<span id="cbQtd"></span><b>${ag?"Continuar agendamento":"Ver pedido"}</b><span id="cbTot"></span></button>
<dialog id="cart" aria-labelledby="ctitle"><div class="sheet">
<div class="sh-top"><h2 id="ctitle">${ag?"Seu agendamento":"Seu pedido"}</h2><button type="button" class="x" data-close aria-label="Fechar">×</button></div>
<div id="itens"></div>
<div class="campos">
<label>Seu nome<input id="fNome" autocomplete="name"></label>
${ag?`<label>Dia e horário que você prefere<input id="fQuando" placeholder="Ex.: sábado, às 10h"></label>`:""}
${bairrosTxt}${O.entrega&&O.retirada?`<div class="tipos" role="radiogroup" aria-label="Como receber"><label><input type="radio" name="tipo" value="entrega"> Entrega</label><label><input type="radio" name="tipo" value="retirada"> Retirar no local</label></div>`:""}
${O.entrega?`<div id="lEnd" class="ende"><p class="ende-t">Endereço de entrega</p>
<label>Bairro<input id="fBairro" list="bairrosLista" autocomplete="off" placeholder="${bairrosLista.length?"Digite para buscar o bairro":"Seu bairro"}"></label>${bairrosLista.length?`<datalist id="bairrosLista">${bairrosLista.map(b=>`<option value="${esc(b.nome)}">`).join("")}</datalist>`:""}
<label>Rua<input id="fRua" autocomplete="address-line1" placeholder="Nome da rua"></label>
<label>Cidade<input id="fCidade" autocomplete="address-level2" placeholder="Cidade"></label>
<div class="tipos" role="radiogroup" aria-label="Tipo de endereço"><label><input type="radio" name="local" value="casa" checked> Casa</label><label><input type="radio" name="local" value="apto"> Apartamento</label></div>
<div id="eCasa"><label>Número da casa<input id="fNum" inputmode="numeric" placeholder="Ex.: 123"></label></div>
<div id="eApto" hidden><label>Condomínio / prédio<input id="fCond" placeholder="Nome do condomínio"></label><div class="duas"><label>Bloco<input id="fBloco" placeholder="Ex.: B"></label><label>Apto<input id="fApto" inputmode="numeric" placeholder="Ex.: 302"></label></div></div>
<label>Ponto de referência <small>(opcional)</small><input id="fRef" placeholder="Ex.: em frente à padaria"></label>
</div>`:""}
${pags.length?`<label>Pagamento<select id="fPag">${pags.map(p=>`<option>${esc(p)}</option>`).join("")}</select></label>`:""}
${O.pix?`<p class="pix">Chave Pix: <b>${esc(O.pix)}</b></p>`:""}
<label>Observação<textarea id="fObs" rows="2" placeholder="${esc(O.obsDica||"")}"></textarea></label>
</div>
<div class="tot" id="totais"></div>
<p class="erro" id="erro" role="alert"></p>
<button type="button" class="enviar" id="enviar">${svg("whats")}<span>${esc(O.botao||PEDIDO_PADRAO.botao)}</span></button>
</div></dialog>`:"";

  // App na tela do celular (v12): manifesto e ícones que o Criador gera na publicação (sem ícone, não entra)
  const icApp=d.slug&&d.icones&&/^\/img\/[\w-]+\/[\w.-]+\.png$/.test(String(d.icones.i192||""))?d.icones:null;
  const appHead=icApp?`
<link rel="manifest" href="/${esc(d.slug)}.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="${esc(icApp.i192)}">
<link rel="apple-touch-icon" href="${esc(icApp.i180||icApp.i192)}">
<meta name="apple-mobile-web-app-title" content="${esc(nomeCurto(d.nome))}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">`:"";
  const appRodape=icApp?`<p class="app-rodape"><button type="button" class="app-link" id="appInstalar" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5zM10.5 18.5h3"/></svg><span>Colocar na tela do celular</span></button></p>`:"";
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(d.cor)}">${appHead}
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fam}&display=swap">
<script defer src="/_vercel/speed-insights/script.js"><\/script>
<style>
:root{--cor:${d.cor};--sobre:${sobre(d.cor)};--acento:${acento};--sobre-acento:${sobre(acento)};--fundo:${d.fundo};--texto:${d.texto};--ft:"${fT}",Georgia,serif;--fb:"${fB}",system-ui,sans-serif;
--linha:color-mix(in srgb,var(--texto) 14%,transparent);--suave:color-mix(in srgb,var(--texto) 6%,var(--fundo))}
${bioEstilos()}</style>
<script type="application/json" id="bio-config">${configJSON(d)}<\/script>
</head>
<body class="t-${esc(d.modelo)}${temCat?" tem-cat":""}">${d.demonstracao==="vitrine"?`<div class="demo-faixa" role="note"><b>Demonstração do Bio Site</b><span>Aqui nada é enviado.</span><a href="/painel-dono?demo=dono">Ver o painel do dono</a><a href="/#demonstracao">Voltar</a></div>`:""}<div class="pg">
${d.modelo==="vitrine"?`<div class="capa"${capa?` style="background-image:url('${esc(capa)}')"`:""}></div>`:""}
<header class="topo">
${logo?`<img class="logo" src="${esc(logo)}" alt="Logo ${esc(d.nome)}">`:`<div class="logo" aria-hidden="true">${iniciais}</div>`}
<h1>${esc(d.nome)}</h1>
${d.descricao?`<p class="sub">${esc(d.descricao)}</p>`:""}
${nota}
${temCat?acoes:""}
</header>
${agCta}
${barbBloco}
${proteseBloco}${svcsBloco}
${clubeBloco}
${links}
${catalogo}
${avaliar}
${mais}
${infoBloco}
${appRodape}
<footer>${esc(d.nome)}${d.cidade?" · "+esc(d.cidade):""}</footer>
</div>
${sheet}
${agDlg}
${icApp?`<script>(${appRuntime.toString()})()<\/script>`:""}
${temCat?`<script>(${bioRuntime.toString()})()<\/script>`:""}
${agOk?`<script>(${agendaRuntime.toString()})()<\/script>`:""}
<script>(function(){var n=0;function e(t,d){if(n++>3||!navigator.sendBeacon)return;try{navigator.sendBeacon("/api/config",new Blob([JSON.stringify({tipo:"erro",nome:String(t),detalhe:String(d).slice(0,500),rota:location.pathname})],{type:"application/json"}))}catch(x){}}addEventListener("error",function(v){e((v.error&&v.error.name)||"Error",v.message+" @"+v.lineno)});addEventListener("unhandledrejection",function(v){e("Promise",(v.reason&&v.reason.message)||v.reason)})})()<\/script>
</body></html>`;
}
function redirectHTML(url){
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=${esc(url)}"><title>Avaliar no Google</title><script>location.replace(${JSON.stringify(url)})<\/script></head><body><p><a href="${esc(url)}">Abrir avaliação no Google</a></p></body></html>`;
}


var Gerador={VERSAO:20,precoTxt:precoTxt,manifestJSON:manifestJSON,nomeCurto:nomeCurto,desenharIcone:desenharIcone,FONTS:FONTS,PEDIDO_PADRAO:PEDIDO_PADRAO,esc:esc,safeUrl:safeUrl,safeImg:safeImg,num:num,brl:brl,sobre:sobre,bioHTML:bioHTML,redirectHTML:redirectHTML,configJSON:configJSON};
if(typeof module!=="undefined"&&module.exports) module.exports=Gerador; else root.Gerador=Gerador;
})(typeof self!=="undefined"?self:this);
