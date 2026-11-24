// Script do site publicado: o "app" da barbearia na tela do celular (instalar, avisos e confirmação de presença).
// Roda dentro do site publicado: o gerador serializa esta função com toString(). Ela não pode usar nada de fora dela.
function appRuntime(){
  var C=JSON.parse(document.getElementById("bio-config").textContent);
  if(!C.slug||!C.icones||!C.icones.i192)return;
  var chave="bio-app-"+C.slug,DIA=864e5;
  function ler(){try{return JSON.parse(localStorage.getItem(chave)||"{}")||{}}catch(e){return {}}}
  function gravar(o){try{localStorage.setItem(chave,JSON.stringify(Object.assign(ler(),o)))}catch(e){}}
  function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  var ua=navigator.userAgent||"";
  var ios=/iPhone|iPad|iPod/.test(ua)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
  var android=/Android/i.test(ua);
  // Navegador de dentro do Instagram, Facebook, TikTok...: não instala; o cliente abre no navegador primeiro
  var dentroDeApp=/Instagram|FBAN|FBAV|FB_IAB|FBIOS|Line\/|TikTok|musical_ly|Snapchat|Twitter/i.test(ua);
  var celular=ios||android||!!(window.matchMedia&&matchMedia("(pointer:coarse)").matches&&screen.width<900);
  var instalado=!!((window.matchMedia&&matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true);
  var nome=C.nome||"barbearia",evento=null,faixa=null,timer=null;

  // Android (Chrome, Samsung): o navegador avisa que dá para instalar; o botão "Instalar" usa esse aviso
  window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();evento=e;mostrarLink();agendarFaixa(Math.max(1500,5000-(window.performance&&performance.now?performance.now():0)))});
  window.addEventListener("appinstalled",function(){gravar({instalado:Date.now()});evento=null;fecharFaixa();mostrarLink()});

  function podeInstalar(){return !instalado&&!ler().instalado&&(!!evento||celular)}
  function mostrarLink(){var b=document.getElementById("appInstalar");if(b)b.hidden=!podeInstalar()}
  function instalar(){
    if(evento){
      var e=evento;evento=null;fecharFaixa();
      try{e.prompt();(e.userChoice||Promise.resolve({})).then(function(r){if(r&&r.outcome==="accepted")gravar({instalado:Date.now()});mostrarLink()})}catch(x){comoColocar()}
      return;
    }
    comoColocar();
  }
  var ICO_COMP='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6"/></svg>';
  function comoColocar(){
    fecharFaixa();
    var passos;
    if(dentroDeApp)passos=["Toque no menu <b>⋯</b> no canto da tela.","Escolha <b>Abrir no navegador</b> (Safari ou Chrome).","No navegador, toque em <b>Colocar na tela do celular</b>, no fim da página."];
    else if(ios)passos=["Toque em <b>Compartilhar</b> "+ICO_COMP+" (no Safari fica na barra de baixo ou no menu <b>⋯</b>).","Role a lista e toque em <b>Adicionar à Tela de Início</b>.","Toque em <b>Adicionar</b>. Pronto: o ícone da "+esc(nome)+" fica na tela do seu iPhone.","Abra a "+esc(nome)+" pelo ícone novo e toque em <b>Permitir</b> quando pedir os avisos. No iPhone, os lembretes do horário só chegam assim."];
    else passos=["Toque no menu <b>⋮</b> do navegador (no canto de cima).","Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.","Confirme. Pronto: o ícone da "+esc(nome)+" fica na tela do celular."];
    var d=document.getElementById("appComo");
    if(!d){
      d=document.createElement("dialog");d.id="appComo";d.setAttribute("aria-labelledby","appComoT");document.body.appendChild(d);
      d.addEventListener("click",function(e){if(e.target===d||e.target.closest("[data-close]")){if(d.close)d.close();else d.removeAttribute("open")}});
    }
    d.innerHTML='<div class="sheet"><div class="sh-top"><h2 id="appComoT">Colocar na tela do celular</h2><button type="button" class="x" data-close aria-label="Fechar">×</button></div><div class="app-icone"><img src="'+esc(C.icones.i192)+'" alt=""><div><b>'+esc(nome)+'</b><small>Abre como um app, direto no agendamento</small></div></div><ol class="app-passos">'+passos.map(function(p){return "<li><span>"+p+"</span></li>"}).join("")+'</ol></div>';
    if(d.showModal){if(!d.open)d.showModal()}else d.setAttribute("open","");
  }

  // Faixa no pé da tela: aparece sozinha (volta 14 dias depois de "Agora não") e nunca por cima de uma janela aberta
  function dispensada(){var x=ler();return !!x.instalado||!!(x.dispensada&&Date.now()-x.dispensada<14*DIA)}
  function agendarFaixa(ms){
    if(instalado||!celular||dentroDeApp||dispensada()||faixa||timer)return;
    if(!evento&&!ios)return;
    timer=setTimeout(function tenta(){timer=null;if(document.querySelector("dialog[open]")){timer=setTimeout(tenta,4000);return}mostrarFaixa()},ms);
  }
  function mostrarFaixa(){
    if(faixa||instalado||dispensada())return;
    faixa=document.createElement("div");faixa.className="app-faixa";faixa.setAttribute("role","region");faixa.setAttribute("aria-label","Colocar na tela do celular");
    faixa.innerHTML='<img src="'+esc(C.icones.i192)+'" alt=""><div class="t"><b>Tenha a '+esc(nome)+' no celular</b><small>Agende mais rápido e receba os lembretes</small></div><div class="bts"><button type="button" class="sim">'+(evento?"Instalar":"Como colocar")+'</button><button type="button" class="nao">Agora não</button></div>';
    faixa.querySelector(".sim").onclick=instalar;
    faixa.querySelector(".nao").onclick=function(){gravar({dispensada:Date.now()});fecharFaixa()};
    document.body.appendChild(faixa);
  }
  function fecharFaixa(){if(faixa){faixa.remove();faixa=null}}

  // Avisos no celular (Web Push). No iPhone, só funcionam com o site aberto pelo ícone da tela de início.
  // Na vitrine da página de vendas (demonstração), os avisos não são oferecidos.
  function suportado(){return C.demonstracao!=="vitrine"&&"serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window}
  function permissao(){try{return Notification.permission}catch(e){return "denied"}}
  function bytesDe(b64u){var s=(b64u+"=".repeat((4-(b64u.length%4))%4)).replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0)})}
  function inscricao(pedir){
    return Promise.resolve(pedir?Notification.requestPermission():permissao()).then(function(r){
      if(r!=="granted")throw new Error("permissao");
      return fetch("/api/config").then(function(x){return x.json()});
    }).then(function(c){
      if(!c.vapidPublic)throw new Error("config");
      return navigator.serviceWorker.register("/sw.js").then(function(reg){return navigator.serviceWorker.ready.then(function(){return reg.pushManager.getSubscription().then(function(a){return a||reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytesDe(c.vapidPublic)})})})});
    });
  }
  // o: { pedir (mostra a pergunta do navegador), codigo (pedido recém-feito), novidades (aceite) }
  function ligar(o){
    o=o||{};
    return inscricao(!!o.pedir).then(function(sub){
      var corpo={tipo:"lembrete-cliente",slug:C.slug,subscription:sub.toJSON(),app:true};
      if(o.codigo)corpo.codigo=o.codigo;
      if(o.novidades)corpo.novidades=true;
      return fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)}).then(function(r){if(!r.ok)throw new Error("api");gravar({avisos:Date.now()});return true});
    });
  }
  window.BioApp={podeInstalar:podeInstalar,instalar:instalar,instalado:function(){return instalado},ios:function(){return ios},avisos:{suportado:suportado,permissao:permissao,ligar:ligar}};

  // Aberto pelo ícone: pede os avisos uma vez (volta em 30 dias se recusar); quem já ligou só renova o vínculo
  function cartaoAvisos(){
    if(document.querySelector("dialog[open]")){setTimeout(cartaoAvisos,4000);return}
    var c=document.createElement("div");c.className="app-faixa app-avisos";c.setAttribute("role","region");c.setAttribute("aria-label","Avisos no celular");
    c.innerHTML='<img src="'+esc(C.icones.i192)+'" alt=""><div class="t"><b>Ative os avisos</b><small>Lembrete e confirmação do seu horário e novidades da '+esc(nome)+'</small></div><div class="bts"><button type="button" class="sim">Ativar avisos</button><button type="button" class="nao">Agora não</button></div>';
    var sim=c.querySelector(".sim"),t=c.querySelector(".t"),bts=c.querySelector(".bts");
    sim.onclick=function(){
      sim.disabled=true;sim.textContent="…";
      ligar({pedir:true,novidades:true}).then(function(){t.innerHTML="<b>Avisos ligados ✓</b><small>Você recebe o lembrete dos seus horários</small>";bts.remove();setTimeout(function(){c.remove()},3500)})
      .catch(function(e){gravar({avisosNao:Date.now()});t.innerHTML=e&&e.message==="permissao"?"<b>Avisos bloqueados</b><small>Libere as notificações nas configurações do celular</small>":"<b>Não deu para ligar agora</b><small>Tente de novo mais tarde</small>";bts.remove();setTimeout(function(){c.remove()},5000)});
    };
    c.querySelector(".nao").onclick=function(){gravar({avisosNao:Date.now()});c.remove()};
    document.body.appendChild(c);
  }
  if(instalado&&suportado()){
    var x=ler();
    if(permissao()==="granted"){if(!x.avisos||Date.now()-x.avisos>7*DIA)ligar({}).catch(function(){})}
    // Só barbearia com cadastro no sistema manda avisos (site sem cadastro ou catálogo: não pergunta)
    else if(permissao()==="default"&&!(x.avisosNao&&Date.now()-x.avisosNao<30*DIA))fetch("/api/profissionais?slug="+encodeURIComponent(C.slug)).then(function(r){if(r.ok)setTimeout(cartaoAvisos,1500)}).catch(function(){});
  }

  mostrarLink();
  var b=document.getElementById("appInstalar");if(b)b.addEventListener("click",instalar);
  if(ios)agendarFaixa(6000);
}

module.exports = { appRuntime };
