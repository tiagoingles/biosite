// Script do site publicado: agendamento de horário (serviços, barbeiro, dia, hora, clube e prótese).
// Roda dentro do site publicado: o gerador serializa esta função com toString(). Ela não pode usar nada de fora dela.
function agendaRuntime(){
  var C=JSON.parse(document.getElementById("bio-config").textContent);
  var AG=C.agenda||{};
  var dlg=document.getElementById("agenda");
  if(!dlg)return;
  function $(id){return document.getElementById(id)}
  function num(v){var t=String(v==null?"":v).replace(/[^\d,.]/g,"");if(!t)return NaN;if(t.indexOf(",")>-1)t=t.replace(/\./g,"").replace(",",".");return parseFloat(t)}
  function brl(n){return n.toLocaleString("pt-BR",{style:"currency",currency:"BRL"})}
  function precoTxt(p){var n=num(p);if(p==null||p==="")return "";return isNaN(n)?String(p):(/^\s*a partir de/i.test(String(p))?"a partir de ":"")+brl(n)}
  function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function pad(n){return n<10?"0"+n:""+n}
  var DIAS=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  var MSG_PADRAO="Olá! Quero agendar:\n*{servico}*\nCom: {profissional}\nDia: {dia} às {horario}\nNome: {nome}{obs}";
  // Etapas: servico -> pref (tem preferência de barbeiro?) -> prof (só se sim) -> dia -> dados -> ok
  var etapa="servico",pilha=[],sel={},dias=[],enviando=false,ultimo=null;
  var equipe=null,cacheHoras={},cacheDias={},pres=null;
  // oferta: horários mandados pelo WhatsApp (o cliente escolhe só entre eles); profFixo: barbeiro veio do link
  var oferta=null,profFixo=false;
  // Planos do clube de assinatura (vêm da API junto com a equipe; null quando a barbearia não tem clube)
  var clube=null;
  // Barbearia sem cadastro no sistema (só o site): o pedido vai direto pelo WhatsApp, sem registro
  var semCadastro=false;
  // Barbearia vitrine da página de vendas: o agendamento vai até o fim, mas nada é enviado nem gravado
  var demo=C.demonstracao==="vitrine";
  function carregarEquipe(cb){
    fetch("/api/profissionais?slug="+encodeURIComponent(C.slug)).then(function(r){if(r.status===404)semCadastro=true;return r.ok?r.json():null}).catch(function(){return null}).then(function(j){
      var lista=j&&j.profissionais?j.profissionais:[];
      // Preço cadastrado no financeiro vale no site (é o que vai para o pedido)
      var precos=j&&j.precos||{};
      (AG.servicos||[]).forEach(function(s){
        var v=precos[s.nome];if(typeof v!=="number"||!isFinite(v))return;
        s.preco=(/^\s*a partir de/i.test(String(s.preco||""))?"A partir de ":"")+v.toFixed(2).replace(".",",");
        var card=document.querySelector('[data-agendar="'+String(s.id).replace(/["\\]/g,"")+'"] .svc-t small');
        if(card)card.textContent=[s.duracao,precoTxt(s.preco)].filter(Boolean).join(" · ");
      });
      clube=j&&j.clube&&j.clube.planos&&j.clube.planos.length?j.clube.planos:null;
      if(j&&j.whatsapp)trocarWhats(j.whatsapp);
      equipe=lista.length?lista.map(function(p){return {id:p.id,dbId:p.id,nome:p.nome,foto:p.foto_url||"",servicos:(AG.servicos||[]).map(function(v){return v.id}),dias:[0,1,2,3,4,5,6]}}):(AG.profissionais||[]);
      cb();
    });
  }
  // Serviço incluído em algum plano do clube (sem diferença de acento ou maiúscula)
  function chave(t){return String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase()}
  function noClube(s){return !!(clube&&s&&clube.some(function(pl){return (pl.servicos||[]).some(function(x){return chave(x)===chave(s.nome)})}))}
  function clubeSalvo(){try{return localStorage.getItem("bio-clube-"+C.slug)||""}catch(e){return ""}}
  function salvo(k){try{return localStorage.getItem("bio-"+k+"-"+C.slug)||""}catch(e){return ""}}
  function guardar(k,v){try{if(v)localStorage.setItem("bio-"+k+"-"+C.slug,v)}catch(e){}}
  // Seção do clube no site: cada plano com o botão que chama a barbearia no WhatsApp para assinar
  function desenharClube(){
    var sec=$("clube"),box=$("clubeLista");
    if(!sec||!box)return;
    sec.hidden=!clube;
    box.textContent="";
    (clube||[]).forEach(function(pl){
      var c=document.createElement("article");c.className="plano";
      var t=document.createElement("h3");t.textContent=pl.nome;c.appendChild(t);
      var pr=document.createElement("div");pr.className="plano-preco";pr.textContent=brl(Number(pl.preco));
      var m=document.createElement("small");m.textContent=" por mês";pr.appendChild(m);c.appendChild(pr);
      if(pl.descricao){var d=document.createElement("p");d.textContent=pl.descricao;c.appendChild(d)}
      var r=document.createElement("p");r.className="plano-regras";r.textContent=pl.regras;c.appendChild(r);
      if(whats()){var b=document.createElement("button");b.type="button";b.className="plano-ag";b.setAttribute("data-plano",pl.id);b.textContent="Quero assinar";c.appendChild(b)}
      else{var n=document.createElement("p");n.className="plano-regras";n.textContent="Para assinar, fale com a barbearia.";c.appendChild(n)}
      box.appendChild(c);
    });
    if(clube&&location.hash==="#clube")setTimeout(function(){sec.scrollIntoView({block:"start"})},50);
  }
  // Vários serviços (gerador v19): o primeiro escolhido e os que o cliente somou, um depois do outro, com o mesmo barbeiro
  function escolhidos(){return sel.servico?[sel.servico].concat(sel.mais||[]):[]}
  function nomeServicos(){return escolhidos().map(function(s){return s.nome}).join(" + ")}
  function profs(){var l=escolhidos();return (equipe||[]).filter(function(p){return l.every(function(s){return (p.servicos||[]).indexOf(s.id)>-1})})}
  function duracaoDe(s){var m=parseInt(String(s&&s.duracao||""),10);return m>=5&&m<=240?m:30}
  function duracaoTotal(){var t=escolhidos().reduce(function(a,s){return a+duracaoDe(s)},0);return Math.min(240,t||30)}
  // Serviços que ainda dá para somar: até 4 e 240 minutos no total, e que o barbeiro já escolhido faz
  function candidatos(){var l=escolhidos(),t=duracaoTotal();return (AG.servicos||[]).filter(function(s){return l.indexOf(s)<0&&t+duracaoDe(s)<=240&&(!sel.prof||(sel.prof.servicos||[]).indexOf(s.id)>-1)})}
  function podeMais(){return !oferta&&!!sel.servico&&escolhidos().length<4&&candidatos().length>0}
  // Com a agenda no banco (gerador v20), o cliente escolhe como fazer os vários serviços: "um depois do outro"
  // (mesmo barbeiro ou outro, em horários próximos) ou "no mesmo horário" (cada serviço com um barbeiro)
  function temBanco(){return !semCadastro&&(equipe||[]).some(function(p){return p.dbId})}
  function multi(){return escolhidos().length>1&&temBanco()&&!oferta}
  function junto(){return multi()&&sel.modo==="junto"}
  function blocoServicos(){
    if(oferta||!sel.servico)return "";
    var varios=escolhidos().length>1;
    var como=!varios?"":junto()?" · cada serviço com um barbeiro, no mesmo horário":multi()?" no total · um depois do outro, com o mesmo barbeiro ou em horários próximos":" no total · um depois do outro, com o mesmo barbeiro";
    var tempo=junto()?escolhidos().map(function(s){return duracaoDe(s)+" min"}).join(" e "):duracaoTotal()+" min";
    var h='<p class="cobertura"><b>'+esc(nomeServicos())+'</b><br><small>'+tempo+como+'</small></p>';
    if(sel.mais&&sel.mais.length)h+='<div class="ag-chips">'+sel.mais.map(function(s,i){return '<button type="button" data-ag="tirar" data-i="'+i+'" aria-label="Tirar '+esc(s.nome)+'">'+esc(s.nome)+' ✕</button>'}).join("")+'</div>';
    if(multi()&&!profFixo)h+='<p class="ag-sub">Como prefere?</p><div class="ag-chips"><button type="button" data-ag="modo" data-v="seguido"'+(junto()?'':' aria-pressed="true"')+'>Um depois do outro</button><button type="button" data-ag="modo" data-v="junto"'+(junto()?' aria-pressed="true"':'')+'>No mesmo horário, com outro barbeiro</button></div>';
    if(podeMais())h+='<button type="button" class="ag-op" data-ag="mais"><b>+ Adicionar outro serviço</b><small>Faça mais de um serviço na mesma visita</small></button>';
    return h;
  }
  function isoDe(dt){return dt.getFullYear()+"-"+pad(dt.getMonth()+1)+"-"+pad(dt.getDate())}
  function dataDe(iso){var p=String(iso).split("-");return new Date(+p[0],+p[1]-1,+p[2])}
  function doBanco(){return !!(sel.qualquer||(sel.prof&&sel.prof.dbId))}
  // Dias com agenda publicada no banco (null enquanto carrega)
  function diasDoBanco(){
    var pid=sel.qualquer?"qualquer":sel.prof.dbId;
    if(cacheDias[pid])return cacheDias[pid];
    if(!cacheDias[pid+"!"]){
      cacheDias[pid+"!"]=1;
      fetch("/api/horarios?slug="+encodeURIComponent(C.slug)+"&profissional="+encodeURIComponent(pid)+"&dias=1").then(function(r){return r.ok?r.json():{dias:[]}}).catch(function(){return {dias:[]}}).then(function(j){cacheDias[pid]=(j.dias||[]).slice(0,14).map(dataDe);render()});
    }
    return null;
  }
  // Site sem equipe no banco: dias da semana e horários cadastrados no Criador
  function diasDe(p){var out=[],h=new Date();for(var i=0;i<30&&out.length<10;i++){var dt=new Date(h.getFullYear(),h.getMonth(),h.getDate()+i);if(!p||(p.dias||[]).indexOf(dt.getDay())>-1)out.push(dt)}return out}
  function horasDe(p){var h=[],a=String((p&&p.inicio)||"09:00").split(":"),b=String((p&&p.fim)||"18:00").split(":");var t=+a[0]*60+ +a[1],f=+b[0]*60+ +b[1];for(;t<f;t+=30)h.push(pad(Math.floor(t/60))+":"+pad(t%60));return h}
  // Horários livres do banco: de um barbeiro, ou de qualquer um (qualquer=true). Devolve null enquanto carrega.
  function horasDoBanco(dia){
    var pid=sel.qualquer?"qualquer":sel.prof.dbId;
    var k=pid+"|"+dia+"|"+duracaoTotal();
    if(cacheHoras[k])return cacheHoras[k];
    if(!cacheHoras[k+"!"]){
      cacheHoras[k+"!"]=1;
      fetch("/api/horarios?slug="+encodeURIComponent(C.slug)+"&profissional="+encodeURIComponent(pid)+"&dia="+dia+"&duracao="+duracaoTotal()).then(function(r){return r.ok?r.json():{horarios:[]}}).catch(function(){return {horarios:[]}}).then(function(j){cacheHoras[k]=j.horarios||[];render()});
    }
    return null;
  }
  // Vários serviços: os planos do servidor (quem faz cada serviço e a que horas). Devolve null enquanto carrega.
  function planosDoBanco(dia){
    var modo=junto()?"junto":"seguido";
    var pid=junto()||sel.qualquer?"qualquer":sel.prof.dbId;
    var ds=escolhidos().map(duracaoDe).join(",");
    var k="planos|"+pid+"|"+dia+"|"+ds+"|"+modo;
    if(cacheHoras[k])return cacheHoras[k];
    if(!cacheHoras[k+"!"]){
      cacheHoras[k+"!"]=1;
      fetch("/api/horarios?slug="+encodeURIComponent(C.slug)+"&profissional="+encodeURIComponent(pid)+"&dia="+dia+"&duracoes="+ds+"&modo="+modo).then(function(r){return r.ok?r.json():{planos:[]}}).catch(function(){return {planos:[]}}).then(function(j){cacheHoras[k]=j.planos||[];render()});
    }
    return null;
  }
  function nomesDoPlano(p){var n=[];((p&&p.itens)||[]).forEach(function(x){if(n.indexOf(x.nome)<0)n.push(x.nome)});return n.join(" e ")}
  function linhasDoPlano(p){return escolhidos().map(function(s,i){var x=(p.itens||[])[i]||{};return esc(s.nome)+" com "+esc(x.nome||"")+" às "+esc(x.horario||"")}).join("<br>")}
  function minDe(t){var p=String(t||"0:0").split(":");return +p[0]*60+ +p[1]}
  // Busca de serviço quando a lista é grande: esconde os que não têm o texto digitado
  function campoBusca(n){return n>6?'<input type="search" id="agBusca" class="ag-busca" placeholder="Buscar serviço (ex.: barba)" aria-label="Buscar serviço" autocomplete="off" value="'+esc(sel.busca||"")+'"><p class="note" id="agSemBusca" hidden>Nenhum serviço com esse nome.</p>':""}
  function filtrarServicos(){
    var q=chave(sel.busca||""),bs=document.querySelectorAll("#agSteps [data-busca]"),n=0;
    for(var i=0;i<bs.length;i++){var ok=!q||bs[i].getAttribute("data-busca").indexOf(q)>-1;bs[i].hidden=!ok;if(ok)n++}
    var v=$("agSemBusca");if(v)v.hidden=n>0||!q;
  }
  function rotuloDia(dt){return DIAS[dt.getDay()]+" "+pad(dt.getDate())+"/"+pad(dt.getMonth()+1)}
  function porId(lista,id){return lista.filter(function(x){return x.id===id})[0]}
  function whats(){var w=String(C.whatsapp||"").replace(/\D/g,"");if(w&&w.indexOf("55")!==0)w="55"+w;return w}
  function linkWhats(txt){return "https://wa.me/"+whats()+"?text="+encodeURIComponent(txt)}
  // WhatsApp cadastrado no painel (gerador v15): vale no lugar do número publicado no site, sem republicar.
  // Troca também os botões de WhatsApp que já estão na página.
  function trocarWhats(n){
    n=String(n||"").replace(/\D/g,"");if(!/^\d{10,11}$/.test(n))return;
    var novo="55"+n,velho=whats();if(novo===velho)return;
    C.whatsapp=novo;if(!velho)return;
    var links=document.querySelectorAll('a[href^="https://wa.me/'+velho+'"]');
    for(var i=0;i<links.length;i++)links[i].setAttribute("href",links[i].getAttribute("href").replace("https://wa.me/"+velho,"https://wa.me/"+novo));
  }
  function abrirLink(url){var a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove()}
  function botaoWhats(rotulo){return whats()?'<button type="button" class="ag-op" data-ag="whats"><b>'+esc(rotulo||"Falar com a barbearia no WhatsApp")+'</b><small>A barbearia combina o horário com você</small></button>':""}
  function ir(e){pilha.push(etapa);etapa=e;render()}
  // Ao voltar para uma etapa, limpa o que foi escolhido depois dela
  function limpar(depois){
    if(!profFixo){
      if(depois==="servico"){sel.pref=null;sel.prof=null;sel.qualquer=false}
      if(depois==="servico"||depois==="pref"){sel.prof=null;sel.qualquer=false}
    }
    if(depois!=="dados"){sel.hora=null;sel.plano=null}
    if(depois==="servico"||depois==="pref"||depois==="prof"||depois==="dia"){sel.dia=null}
    if(depois==="servico"){sel.mais=[];sel.modo=null;sel.busca=""}
  }
  function escolherDia(i){var dt=dias[i];if(!dt)return;sel.dia=i;sel.diaTxt=rotuloDia(dt);sel.diaISO=isoDe(dt);sel.hora=null}
  // Arquivo de calendário (.ics) do agendamento, para o cliente salvar no celular
  function linkCalendario(){
    if(!ultimo||!window.Blob||!window.URL||!URL.createObjectURL)return "";
    var p=ultimo.diaISO.split("-"),h=ultimo.hora.split(":"),ini=new Date(+p[0],+p[1]-1,+p[2],+h[0],+h[1]),fim=new Date(ini.getTime()+ultimo.duracao*60000);
    function f(d){return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"T"+pad(d.getHours())+pad(d.getMinutes())+"00"}
    var limpa=function(t){return String(t||"").replace(/[\r\n,;\\]/g," ")};
    var ics=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//biosite//agenda//PT","BEGIN:VEVENT","UID:"+ultimo.codigo+"-"+Date.now()+"@biosite","DTSTAMP:"+f(new Date()),"DTSTART:"+f(ini),"DTEND:"+f(fim),"SUMMARY:"+limpa(ultimo.servico+" - "+C.nome),"DESCRIPTION:"+limpa("Com "+ultimo.quem+(ultimo.codigo?". Código "+ultimo.codigo:"")),(C.endereco?"LOCATION:"+limpa(C.endereco):""),"BEGIN:VALARM","TRIGGER:-PT1H","ACTION:DISPLAY","DESCRIPTION:Lembrete","END:VALARM","END:VEVENT","END:VCALENDAR"].filter(Boolean).join("\r\n");
    try{return URL.createObjectURL(new Blob([ics],{type:"text/calendar"}))}catch(e){return ""}
  }
  function render(){
    var h=pilha.length&&etapa!=="ok"?'<button type="button" class="ag-voltar" data-ag="voltar">← Voltar</button>':"";
    var titulo="";
    $("agEnviar").hidden=etapa!=="dados";
    if(etapa==="servico"){
      titulo="Escolha o serviço";
      if(oferta&&sel.prof)h+=notaOferta();
      var todos=AG.servicos||[];
      h+=campoBusca(todos.length);
      todos.forEach(function(s){
        var preco=precoTxt(s.preco);
        var info=[s.duracao,preco].filter(Boolean).join(" · ");
        h+='<button type="button" class="ag-op" data-ag="servico" data-id="'+esc(s.id)+'" data-busca="'+esc(chave(s.nome))+'"><b>'+esc(s.nome)+'</b>'+(info?'<small>'+esc(info)+'</small>':"")+'</button>';
      });
    }else if(etapa==="pref"){
      titulo=junto()?"No mesmo horário":"Você tem preferência de barbeiro?";
      h+=blocoServicos();
      if(junto())h+='<button type="button" class="ag-op" data-ag="sem-pref"><b>Ver os horários</b><small>Mostro os horários com barbeiros livres ao mesmo tempo</small></button>';
      else{
        h+='<button type="button" class="ag-op" data-ag="tem-pref"><b>Sim, quero escolher</b><small>Ver os barbeiros disponíveis</small></button>';
        h+='<button type="button" class="ag-op" data-ag="sem-pref"><b>Não, tanto faz</b><small>Vejo os horários livres de toda a equipe</small></button>';
      }
    }else if(etapa==="prof"){
      titulo="Escolha seu barbeiro";
      h+=blocoServicos();
      var lista=profs();
      lista.forEach(function(p){h+='<button type="button" class="ag-op" data-ag="prof" data-id="'+esc(p.id)+'"><b>'+esc(p.nome)+'</b></button>'});
      if(!equipe)h+='<p class="note">Carregando a equipe…</p>';
      else if(!lista.length)h+='<p class="note">'+(escolhidos().length>1?"Nenhum profissional faz todos estes serviços. Tire um deles.":"Nenhum profissional faz este serviço no momento.")+'</p>';
    }else if(etapa==="dia"&&oferta&&sel.prof){
      titulo="Escolha um dos horários";
      h+=htmlOferta();
    }else if(etapa==="dia"){
      titulo="Escolha o dia e o horário";
      h+=blocoServicos();
      var lidos=doBanco()?diasDoBanco():diasDe(sel.qualquer?null:sel.prof);
      if(lidos===null){dias=[];h+='<p class="note">Carregando a agenda…</p>'}
      else{
        dias=lidos;
        if(!dias.length){h+='<p class="note">Ainda não há horários publicados para agendar pelo site.</p>'+botaoWhats()}
        else{
          if(sel.dia==null)escolherDia(0);
          h+='<div class="ag-chips">'+dias.map(function(dt,i){return '<button type="button" data-ag="dia" data-i="'+i+'"'+(sel.dia===i?' aria-pressed="true"':'')+'>'+rotuloDia(dt)+'</button>'}).join("")+'</div>';
          if(multi()){
            // Vários serviços: cada horário é um plano com o barbeiro e a hora de cada serviço
            var ps=planosDoBanco(sel.diaISO);
            if(ps===null)h+='<p class="note">Procurando horários para os serviços…</p>';
            else if(!ps.length)h+='<p class="note">'+(junto()?"Sem barbeiros livres ao mesmo tempo neste dia. Escolha outro dia ou \"Um depois do outro\".":"Sem horário para todos os serviços neste dia. Escolha outro dia"+(sel.prof&&!sel.qualquer?" ou volte e escolha \"Não, tanto faz\" para ver outros barbeiros":" ou \"No mesmo horário\"")+".")+'</p>';
            else{sel.planos=ps;h+='<p class="ag-sub">Horários</p><div class="ag-chips">'+ps.map(function(p,i){return '<button type="button" data-ag="plano" data-i="'+i+'">'+esc(p.horario)+'</button>'}).join("")+'</div>'}
          }else{
            var hs=doBanco()?horasDoBanco(sel.diaISO):horasDe(sel.prof);
            if(hs===null)h+='<p class="note">Carregando horários…</p>';
            else if(!hs.length)h+='<p class="note">Sem horários livres neste dia. Escolha outro dia.</p>';
            else h+='<p class="ag-sub">Horários</p><div class="ag-chips">'+hs.map(function(t){return '<button type="button" data-ag="hora" data-v="'+t+'">'+t+'</button>'}).join("")+'</div>';
          }
        }
      }
    }else if(etapa==="mais"){
      // Somar outro serviço ao mesmo horário: fica depois do anterior, com o mesmo barbeiro
      titulo="Adicionar outro serviço";
      h+='<p class="note">'+(temBanco()&&!profFixo?"Depois você escolhe: um depois do outro ou no mesmo horário, com outro barbeiro.":"Os serviços ficam um depois do outro, com o mesmo barbeiro.")+'</p>';
      var cands=candidatos();
      h+=campoBusca(cands.length);
      cands.forEach(function(s){
        var info=[s.duracao,precoTxt(s.preco)].filter(Boolean).join(" · ");
        h+='<button type="button" class="ag-op" data-ag="mais-servico" data-id="'+esc(s.id)+'" data-busca="'+esc(chave(s.nome))+'"><b>'+esc(s.nome)+'</b>'+(info?'<small>'+esc(info)+'</small>':"")+'</button>';
      });
    }else if(etapa==="dados"){
      titulo="Seus dados";
      var com=sel.qualquer?"Qualquer barbeiro disponível":sel.prof?sel.prof.nome:"";
      // Com o plano: quem faz cada serviço e a que horas
      h+='<p class="cobertura">'+(sel.plano?linhasDoPlano(sel.plano)+'<br>'+esc(sel.diaTxt):esc(nomeServicos())+' com '+esc(com)+'<br>'+esc(sel.diaTxt)+' às '+esc(sel.hora))+'</p>';
      // Pelo clube, um serviço por vez
      var doClube=!(sel.mais&&sel.mais.length)&&noClube(sel.servico)?clubeSalvo():null;
      var zap=doClube||salvo("zap");
      var blocoZap=semCadastro?"":'<label>Seu WhatsApp<input id="agWhats" type="tel" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000" maxlength="20"'+(demo?'':' required')+' value="'+esc(zap)+'"><small class="ag-dica">'+(demo?'Na barbearia de verdade é obrigatório: serve para confirmar o horário e avisar se ele mudar. Na demonstração, pode deixar em branco.':'Obrigatório: a barbearia usa para confirmar o horário e avisar você se ele precisar mudar.')+'</small></label>';
      var blocoClube=doClube===null?"":'<label class="check"><input type="checkbox" id="agClube"'+(doClube?" checked":"")+'><span>Sou assinante do clube <small>(com o WhatsApp cadastrado no clube)</small></span></label>';
      var blocoNovidades=semCadastro?"":'<label class="check"><input type="checkbox" id="agNovidades"><span>Quero receber promoções e novidades da '+esc(C.nome)+' pelo WhatsApp</span></label>';
      h+='<div class="campos"><input id="agSite" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px"><label>Seu nome<input id="agNome" autocomplete="name" placeholder="Seu nome" maxlength="80" value="'+esc(salvo("nome"))+'"></label>'+blocoZap+blocoClube+blocoNovidades+'<label>Observação <small>(opcional)</small><textarea id="agObs" rows="2" maxlength="200"></textarea></label></div>';
    }else if(etapa==="demo"){
      // Vitrine: mostra o que aconteceria numa barbearia de verdade, sem gravar nem abrir o WhatsApp
      titulo="Pronto: é assim que o cliente agenda";
      h+='<p class="cobertura"><b>'+esc(nomeServicos())+'</b> com '+esc(sel.qualquer?"Qualquer barbeiro disponível":sel.prof.nome)+'<br>'+esc(sel.diaTxt)+' às '+esc(sel.hora)+'</p>';
      h+='<p class="note">Numa barbearia de verdade, este pedido entraria agora na agenda do painel, com aviso no celular do dono e do barbeiro, e o cliente receberia a confirmação. Esta é só uma demonstração: nada foi enviado.</p>';
      h+='<a class="ag-op" href="/painel-dono?demo=dono"><b>Ver o painel do dono</b><small>A agenda, os clientes e o financeiro desta barbearia</small></a>';
      if(whats())h+='<a class="ag-op" href="'+esc(linkWhats("Olá! Vi a demonstração da "+C.nome+" e quero o Bio Site na minha barbearia."))+'" target="_blank" rel="noopener"><b>Quero na minha barbearia</b><small>Fale com o Bio Site no WhatsApp</small></a>';
    }else if(etapa==="presenca"){
      var dd=pres&&pres.dados,ativo=!!dd&&dd.status!=="cancelado";
      titulo=dd&&dd.anterior?(ativo&&dd.resposta==="sim"?"Novo horário aceito":ativo?"Seu horário mudou":"Seu horário"):(ativo&&dd.resposta==="sim"?"Presença confirmada":"Seu horário");
      h+=htmlPresenca();
    }else{
      // Barbearia com confirmação automática: o horário já está garantido e o WhatsApp é só para falar com ela
      titulo=ultimo.sinal?"Falta o sinal":ultimo.confirmado?"Horário confirmado":"Pedido enviado";
      var cal=linkCalendario();
      h+='<p class="cobertura"><b>'+esc(ultimo.servico)+'</b> com '+esc(ultimo.quem)+'<br>'+esc(ultimo.diaTxt)+' às '+esc(ultimo.hora)+(ultimo.codigo?'<br>Código do pedido: <b>'+esc(ultimo.codigo)+'</b>':'')+(ultimo.clube?'<br><b>Pelo clube de assinatura</b>':'')+'</p>';
      if(ultimo.sinal){
        // Sinal no Pix: copia e cola e QR com o valor; a barbearia confere e confirma
        var sv=ultimo.sinal;
        h+='<div class="sinal-box"><b>Sinal de R$ '+esc(Number(sv.valor).toFixed(2).replace(".",","))+' no Pix</b><small>Pague em até '+esc(sv.prazoMin)+' min para garantir o horário. Depois a barbearia confirma.</small><div id="sinalQr" class="sinal-qr" aria-label="QR Code do Pix"></div></div>';
        h+='<button type="button" class="ag-op" data-ag="pix-copiar"><b>Copiar código Pix</b><small>Cole no app do banco, em Pix copia e cola</small></button>';
        h+='<p class="note">Chave Pix: <b>'+esc(sv.chave)+'</b>'+(sv.recebedor?' · '+esc(sv.recebedor):'')+'</p>';
        h+='<a class="ag-op" href="'+esc(ultimo.linkPago)+'" target="_blank" rel="noopener"><b>Já paguei: avisar a barbearia</b><small>Manda o código do pedido no WhatsApp</small></a>';
      }else if(ultimo.confirmado){
        h+='<p class="note">Seu horário está garantido. Se precisar mudar alguma coisa, fale com a barbearia.</p>';
        h+='<a class="ag-op" href="'+esc(ultimo.link)+'" target="_blank" rel="noopener"><b>Falar com a barbearia</b><small>Pelo WhatsApp, se precisar mudar</small></a>';
      }else{
        h+='<p class="note">A barbearia confirma pelo WhatsApp. Se o WhatsApp não abriu sozinho, toque abaixo.</p>';
        h+='<a class="ag-op" href="'+esc(ultimo.link)+'" target="_blank" rel="noopener"><b>Abrir o WhatsApp</b><small>Enviar a mensagem com o pedido</small></a>';
      }
      h+=blocoAvisos();
      if(cal)h+='<a class="ag-op" href="'+cal+'" download="agendamento.ics"><b>Salvar na agenda do celular</b><small>Com lembrete 1 hora antes</small></a>';
    }
    $("agTitulo").textContent=titulo;
    $("agSteps").innerHTML=h;
    if(etapa==="servico"||etapa==="mais")filtrarServicos();
    if(etapa==="ok"&&ultimo&&ultimo.sinal)desenharQrPix();
  }
  function abrir(){pilha=[];etapa="servico";sel={};oferta=null;profFixo=false;cacheHoras={};cacheDias={};$("agErro").textContent="";render();if(dlg.showModal)dlg.showModal();else dlg.setAttribute("open","")}
  function fechar(){if(dlg.close)dlg.close();else dlg.removeAttribute("open")}
  $("abrirAgenda").addEventListener("click",abrir);
  // Cada serviço da vitrine abre o agendamento já com ele escolhido: pergunta a preferência de barbeiro
  function abrirServico(id){abrir();sel.servico=porId(AG.servicos||[],id);if(sel.servico){pilha=["servico"];etapa="pref";render()}}
  // Um barbeiro do painel abre o agendamento já com ele escolhido: segue direto para o serviço
  function abrirBarbeiro(id){abrir();sel.prof=porId(equipe||[],id);if(sel.prof){sel.qualquer=false;profFixo=true;etapa="servico";render()}}
  // Horários que a barbearia mandou pelo WhatsApp ("Mandar horários" do painel):
  // /slug?barbeiro=<id>&dia=2026-11-18&horas=1000-1030-1400[&servico=Nome] — o cliente escolhe só entre eles.
  function lerOferta(){
    try{
      var q=new URLSearchParams(location.search);
      var hs=(q.get("horas")||"").split("-").filter(function(x){return /^([01]\d|2[0-3])[0-5]\d$/.test(x)}).map(function(x){return x.slice(0,2)+":"+x.slice(2)});
      var dia=q.get("dia")||"";
      if(!hs.length||!/^\d{4}-\d{2}-\d{2}$/.test(dia))return null;
      return {dia:dia,horas:hs.filter(function(x,i){return hs.indexOf(x)===i}).sort().slice(0,12),barbeiro:q.get("barbeiro")||"",servico:q.get("servico")||""};
    }catch(e){return null}
  }
  function porNome(n){var k=chave(n);return (AG.servicos||[]).filter(function(s){return chave(s.nome)===k})[0]}
  function abrirOferta(of){
    abrir();
    oferta=of;profFixo=true;
    sel.prof=porId(equipe||[],of.barbeiro);sel.qualquer=false;
    // Serviço que veio no link (ex.: pedido recusado com "Sugerir outros horários"): vai direto para os horários
    var s=of.servico?porNome(of.servico):null;
    if(s&&(sel.prof.servicos||[]).indexOf(s.id)>-1){sel.servico=s;pilha=["servico"];etapa="dia"}
    render();
  }
  function listaTxt(l){return l.length<2?l.join(""):l.slice(0,-1).join(", ")+" e "+l[l.length-1]}
  function notaOferta(){return '<p class="cobertura">Horários separados para você com <b>'+esc(sel.prof.nome)+'</b>: '+esc(rotuloDia(dataDe(oferta.dia)))+' às '+esc(listaTxt(oferta.horas))+'. Escolha o serviço.</p>'}
  function htmlOferta(){
    sel.diaISO=oferta.dia;sel.diaTxt=rotuloDia(dataDe(oferta.dia));
    var h='<p class="ag-sub">'+esc(sel.diaTxt)+' · com '+esc(sel.prof.nome)+'</p>';
    if(oferta.dia<isoDe(new Date()))return h+'<p class="note">Esses horários já passaram. Fale com a barbearia para combinar outro.</p>'+botaoWhats("Combinar outro horário pelo WhatsApp");
    var livres=horasDoBanco(oferta.dia);
    if(livres===null)return h+'<p class="note">Conferindo os horários…</p>';
    var hs=oferta.horas.filter(function(x){return livres.indexOf(x)>-1});
    if(!hs.length)return h+'<p class="note">Os horários enviados não estão mais livres'+(sel.servico?' para '+esc(sel.servico.nome):'')+'. Fale com a barbearia para combinar outro.</p>'+botaoWhats("Combinar outro horário pelo WhatsApp");
    h+='<div class="ag-chips">'+hs.map(function(t){return '<button type="button" data-ag="hora" data-v="'+t+'">'+t+'</button>'}).join("")+'</div>';
    var fora=oferta.horas.length-hs.length;
    if(fora)h+='<p class="note">'+(fora===1?"Um dos horários enviados não está mais livre.":fora+" dos horários enviados não estão mais livres.")+'</p>';
    return h+'<p class="note">Nenhum serve?</p>'+botaoWhats("Pedir outro horário pelo WhatsApp");
  }

  function desenharBarbeiros(){
    var sec=document.getElementById("barbeiros"),box=document.getElementById("barbsLista");
    if(!sec||!box)return;
    var lista=(equipe||[]).filter(function(p){return p.dbId});
    sec.hidden=!lista.length;
    box.textContent="";
    lista.forEach(function(p){
      var b=document.createElement("button");b.type="button";b.className="barb";b.setAttribute("data-barb",p.id);
      b.setAttribute("aria-label","Agendar com "+p.nome);
      var f=document.createElement("span");f.className="barb-foto";
      if(p.foto&&/^https:\/\//.test(p.foto)){var img=document.createElement("img");img.src=p.foto;img.alt=p.nome;img.loading="lazy";f.appendChild(img)}else{f.textContent=String(p.nome||"").trim().split(/\s+/).slice(0,2).map(function(x){return x.charAt(0)}).join("").toUpperCase()}
      var n=document.createElement("b");n.textContent=p.nome;
      b.appendChild(f);b.appendChild(n);box.appendChild(b);
    });
  }
  document.addEventListener("click",function(e){var c=e.target.closest("[data-barb]");if(c)abrirBarbeiro(c.getAttribute("data-barb"))});
  document.addEventListener("click",function(e){var c=e.target.closest("[data-agendar]");if(c)abrirServico(c.getAttribute("data-agendar"))});
  document.addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target.hasAttribute&&e.target.hasAttribute("data-agendar")){e.preventDefault();abrirServico(e.target.getAttribute("data-agendar"))}});
  // Link pessoal do barbeiro (/slug?barbeiro=id): o site já abre o agendamento com ele escolhido
  // Atalho "Agendar horário" do ícone (/slug?agendar=1): o site já abre o agendamento
  function abrirDoLink(){var id="",ag="";try{var q=new URLSearchParams(location.search);id=q.get("barbeiro")||"";ag=q.get("agendar")||""}catch(e){}var of=lerOferta();if(of&&porId(equipe||[],of.barbeiro)){abrirOferta(of);return}if(id&&porId(equipe||[],id))abrirBarbeiro(id);else if(ag&&!dlg.open)abrir()}
  abrirPresenca();
  carregarEquipe(function(){desenharBarbeiros();desenharClube();if(dlg.open)render();else abrirDoLink()});
  // "Quero assinar": abre o WhatsApp da barbearia com o plano escolhido
  document.addEventListener("click",function(e){var c=e.target.closest("[data-plano]");if(!c)return;var pl=porId(clube||[],c.getAttribute("data-plano"));if(pl)abrirLink(linkWhats("Olá! Quero assinar o plano "+pl.nome+" do clube ("+brl(Number(pl.preco))+" por mês). Como faço?"))});
  // Marcar "Sou assinante" (ou as novidades) leva ao campo do WhatsApp, se estiver vazio
  // Busca de serviço: filtra a lista enquanto o cliente digita (sem redesenhar, para não perder o foco)
  $("agSteps").addEventListener("input",function(e){if(e.target.id!=="agBusca")return;sel.busca=e.target.value;filtrarServicos()});
  $("agSteps").addEventListener("change",function(e){if(e.target.id!=="agClube"&&e.target.id!=="agNovidades")return;if(e.target.checked&&$("agWhats")&&!$("agWhats").value.trim())$("agWhats").focus()});
  dlg.querySelector("[data-close]").addEventListener("click",fechar);
  function cliqueWhats(){abrirLink(linkWhats("Olá! Quero agendar um horário"+(sel.servico?" para "+nomeServicos():"")+"."))}
  // Sinal no Pix: QR desenhado pelo /qr.js (carregado só quando precisa) e o copia e cola na área de transferência
  function desenharQrPix(){
    var alvo=$("sinalQr");if(!alvo||!ultimo||!ultimo.sinal)return;
    function pinta(){try{alvo.innerHTML=window.QR.svg(ultimo.sinal.copiaECola)}catch(e){alvo.hidden=true}}
    if(window.QR){pinta();return}
    var s=document.createElement("script");s.src="/qr.js";s.onload=pinta;s.onerror=function(){alvo.hidden=true};document.head.appendChild(s);
  }
  function copiarPix(b){
    var cod=ultimo&&ultimo.sinal?ultimo.sinal.copiaECola:"";if(!cod)return;
    function ok(){b.innerHTML="<b>Código copiado ✓</b><small>Abra o app do banco e escolha Pix copia e cola</small>"}
    if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(cod).then(ok).catch(function(){window.prompt("Copie o código Pix:",cod)});
    else window.prompt("Copie o código Pix:",cod);
  }
  // Avisos no celular (o "app" da barbearia, gerador v12): lembrete, confirmação e mudança de horário, e as
  // novidades com o aceite. Quem já ligou os avisos neste celular não toca em nada: o pedido novo já fica ligado.
  function blocoAvisos(){
    var A=window.BioApp,h="";
    if(ultimo.codigo&&A&&A.avisos.suportado()){
      var perm=A.avisos.permissao();
      if(perm==="granted"){if(ultimo.avisos!=="erro")h+='<p class="note ag-ok">'+(ultimo.avisos==="ok"?"✓ Avisos ligados neste celular: lembrete e confirmação do horário.":"Ligando os avisos deste celular…")+'</p>'}
      else if(perm==="default")h+='<button type="button" class="ag-op" data-ag="avisos"><b>Receber avisos no celular</b><small>Lembrete e confirmação do horário e novidades da '+esc(C.nome)+'</small></button>';
    }else if(ultimo.codigo&&!A&&podeLembrar())h+='<button type="button" class="ag-op" data-ag="lembrete"><b>Lembrete no celular</b><small>Aviso 30 min antes do horário</small></button>';
    // iPhone no Safari: os avisos só existem com o site na tela de início (regra da Apple); o botão explica e mostra como
    if(A&&A.podeInstalar())h+=A.ios&&A.ios()&&!A.avisos.suportado()&&ultimo.codigo&&!demo
      ?'<button type="button" class="ag-op" data-ag="instalar"><b>Receber os avisos no iPhone</b><small>Coloque a '+esc(C.nome)+' na tela de início e abra por lá: é assim que o iPhone libera o lembrete do horário</small></button>'
      :'<button type="button" class="ag-op" data-ag="instalar"><b>Colocar na tela do celular</b><small>Abra a '+esc(C.nome)+' como app e agende em 2 toques</small></button>';
    return h;
  }
  function ligarAvisosAqui(b){
    b.disabled=true;b.innerHTML="<b>Ligando os avisos…</b>";
    window.BioApp.avisos.ligar({codigo:ultimo.codigo,pedir:true,novidades:true}).then(function(){ultimo.avisos="ok";render()})
    .catch(function(e){b.disabled=false;b.innerHTML=e&&e.message==="permissao"?"<b>Avisos bloqueados</b><small>Libere as notificações deste site nas configurações do navegador</small>":"<b>Não deu para ligar os avisos</b><small>Use \"Salvar na agenda do celular\"</small>"});
  }
  // Confirmação de presença: o aviso "Confirme seu horário" (ou "Seu horário mudou") abre /slug?confirmar=TOKEN
  function quandoTxt(dia,hoje){
    if(dia===hoje)return "Hoje";
    var a=new Date(hoje+"T12:00:00");a.setDate(a.getDate()+1);
    if(dia===isoDe(a))return "Amanhã";
    var d=new Date(dia+"T12:00:00");return DIAS[d.getDay()]+" "+pad(d.getDate())+"/"+pad(d.getMonth()+1);
  }
  function htmlPresenca(){
    if(!pres)return "";
    if(!pres.dados&&!pres.erro)return '<p class="note">Carregando seu horário…</p>';
    if(pres.erro)return '<p class="note">'+esc(pres.erro)+'</p>'+botaoWhats();
    // A barbearia mudou o horário: mostra o de antes e as respostas viram "Aceito" e "Não posso"
    var d=pres.dados,mudou=!!d.anterior,antes=mudou?(d.anterior.dia===d.dia?d.anterior.horario:quandoTxt(d.anterior.dia,d.hoje)+" às "+d.anterior.horario):"";
    var h='<p class="cobertura"><b>'+esc(d.servico)+'</b>'+(d.profissional?' com '+esc(d.profissional):'')+'<br>'+(mudou?'Agora: ':'')+esc(quandoTxt(d.dia,d.hoje))+' às '+esc(d.horario)+(mudou?'<br><small>Antes: '+esc(antes)+'</small>':'')+'</p>';
    if(d.status==="cancelado")return h+'<p class="note">'+(pres.feito==="nao"?"Horário cancelado. A barbearia já foi avisada.":"Este horário foi cancelado.")+'</p><button type="button" class="ag-op" data-ag="novo"><b>Agendar outro horário</b><small>Escolha o serviço, o dia e a hora</small></button>';
    if(["pendente","confirmado","avulso"].indexOf(d.status)<0)return h+'<p class="note">Este horário não está mais ativo.</p>'+botaoWhats();
    if(d.passou)return h+'<p class="note">O horário já passou.</p>'+botaoWhats();
    if(pres.querCancelar)return h+'<p class="note">'+(mudou?"Não pode no novo horário? Ele é cancelado e a barbearia é avisada. Depois você pode escolher outro horário.":"Cancelar seu horário? A barbearia é avisada e o horário fica livre para outra pessoa.")+'</p><button type="button" class="ag-op perigo" data-ag="pres-nao-ok"><b>'+(mudou?"Sim, não posso nesse horário":"Sim, cancelar o horário")+'</b></button><button type="button" class="ag-op" data-ag="pres-voltar"><b>Voltar</b></button>';
    if(d.resposta==="sim")h+='<p class="note ag-ok">'+(mudou?"✓ Novo horário aceito. Até lá!":"✓ Presença confirmada. Até lá!")+'</p>';
    else h+='<button type="button" class="ag-op destaque" data-ag="pres-sim"><b>'+(mudou?"Aceito o novo horário":"Confirmo, estarei lá")+'</b><small>A barbearia fica sabendo na hora</small></button>';
    h+='<button type="button" class="ag-op" data-ag="pres-nao"><b>'+(mudou?"Não posso nesse horário":"Não vou poder ir")+'</b><small>'+(mudou?"Cancela e você escolhe outro horário":"Cancela e libera o horário")+'</small></button>';
    if(whats())h+='<a class="ag-op" href="'+esc(linkWhats("Olá! Sobre o meu horário de "+d.servico+" ("+quandoTxt(d.dia,d.hoje).toLowerCase()+" às "+d.horario+")."))+'" target="_blank" rel="noopener"><b>Falar com a barbearia</b><small>Pelo WhatsApp, para remarcar</small></a>';
    return h;
  }
  function jsonDe(r){return r.json().catch(function(){return {}}).then(function(j){return {ok:r.ok,j:j}})}
  function abrirPresenca(){
    var q,t;
    try{q=new URLSearchParams(location.search);t=q.get("confirmar")||""}catch(e){return false}
    if(!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{16}$/i.test(t))return false;
    pres={token:t,dados:null,erro:"",querCancelar:q.get("r")==="nao"};
    try{history.replaceState(null,"",location.pathname)}catch(e){}
    pilha=[];etapa="presenca";$("agErro").textContent="";render();
    if(dlg.showModal){if(!dlg.open)dlg.showModal()}else dlg.setAttribute("open","");
    fetch("/api/config?presenca="+encodeURIComponent(t)).then(jsonDe).catch(function(){return {ok:false,j:{message:"Sem conexão com a internet."}}}).then(function(x){
      if(x.ok)pres.dados=x.j;else pres.erro=x.j.message||"Não deu para abrir seu horário.";
      if(etapa==="presenca")render();
    });
    return true;
  }
  function presencaAcao(a,b){
    if(a==="novo"){pres=null;abrir();return}
    if(!pres||!pres.dados)return;
    if(a==="pres-nao"){pres.querCancelar=true;render();return}
    if(a==="pres-voltar"){pres.querCancelar=false;render();return}
    var resp=a==="pres-sim"?"sim":"nao";
    b.disabled=true;
    fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tipo:"presenca",token:pres.token,resposta:resp})}).then(jsonDe).catch(function(){return {ok:false,j:{message:"Sem conexão com a internet."}}}).then(function(x){
      b.disabled=false;pres.querCancelar=false;
      if(!x.ok){$("agErro").textContent=x.j.message||"Não deu para responder agora.";if(x.j.status)pres.dados.status=x.j.status;render();return}
      pres.feito=resp;pres.dados.resposta=resp;if(resp==="nao")pres.dados.status="cancelado";render();
    });
  }
  // Lembrete no celular do cliente (Web Push), 30 min antes do horário. Sem suporte, o botão nem aparece.
  function podeLembrar(){return "serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window}
  function bytesDe(b64u){var s=(b64u+"=".repeat((4-(b64u.length%4))%4)).replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(s),function(c){return c.charCodeAt(0)})}
  function lembreteCelular(b){
    b.disabled=true;b.innerHTML="<b>Ligando o lembrete…</b>";
    Notification.requestPermission().then(function(perm){
      if(perm!=="granted")throw new Error("permissao");
      return fetch("/api/config").then(function(r){return r.json()});
    }).then(function(c){
      if(!c.vapidPublic)throw new Error("config");
      return navigator.serviceWorker.register("/sw.js").then(function(reg){return navigator.serviceWorker.ready.then(function(){return reg.pushManager.getSubscription().then(function(atual){return atual||reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytesDe(c.vapidPublic)})})})});
    }).then(function(sub){
      return fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tipo:"lembrete-cliente",slug:C.slug,codigo:ultimo.codigo,subscription:sub.toJSON()})}).then(function(r){if(!r.ok)throw new Error("api")});
    }).then(function(){b.innerHTML="<b>Lembrete ligado ✓</b><small>Você recebe um aviso no celular 30 min antes</small>"})
    .catch(function(){b.disabled=false;b.innerHTML="<b>Não deu para ligar o lembrete</b><small>Use \"Salvar na agenda do celular\"</small>"});
  }
  $("agSteps").addEventListener("click",function(e){
    var b=e.target.closest("[data-ag]");if(!b)return;
    var a=b.getAttribute("data-ag");
    $("agErro").textContent="";
    if(a==="lembrete"){lembreteCelular(b);return}
    if(a==="avisos"){ligarAvisosAqui(b);return}
    if(a==="instalar"){if(window.BioApp)window.BioApp.instalar();return}
    if(a==="novo"||a.indexOf("pres-")===0){presencaAcao(a,b);return}
    if(a==="pix-copiar"){copiarPix(b);return}
    if(a==="voltar"){
      if(pilha.length){etapa=pilha.pop();limpar(etapa)}
    }
    else if(a==="servico"){sel.busca="";sel.servico=porId(AG.servicos||[],b.getAttribute("data-id"));if(sel.prof){ir("dia")}else{ir("pref")}}
    // Vários serviços: somar outro (volta para a etapa em que estava) ou tirar um dos somados
    else if(a==="mais"){sel.busca="";ir("mais");return}
    else if(a==="mais-servico"){var ms=porId(AG.servicos||[],b.getAttribute("data-id"));if(ms){sel.mais=(sel.mais||[]).concat([ms]);sel.hora=null;sel.plano=null}sel.busca="";etapa=pilha.pop()||"pref"}
    else if(a==="tirar"){(sel.mais||[]).splice(+b.getAttribute("data-i"),1);sel.hora=null;sel.plano=null}
    // Como fazer os serviços: um depois do outro, ou no mesmo horário (aí o sistema escolhe os barbeiros livres)
    else if(a==="modo"){sel.modo=b.getAttribute("data-v")==="junto"?"junto":"seguido";sel.hora=null;sel.plano=null;if(sel.modo==="junto"&&!profFixo){sel.qualquer=true;sel.prof=null;if(etapa==="prof")etapa="dia"}}
    else if(a==="plano"){var pl=(sel.planos||[])[+b.getAttribute("data-i")];if(pl){sel.plano=pl;sel.hora=pl.horario;ir("dados")}}
    else if(a==="tem-pref"){ir("prof")}
    else if(a==="sem-pref"){sel.qualquer=true;sel.prof=null;sel.dia=null;ir("dia")}
    else if(a==="prof"){sel.prof=porId(equipe||[],b.getAttribute("data-id"));sel.qualquer=false;sel.dia=null;ir("dia")}
    else if(a==="dia"){escolherDia(+b.getAttribute("data-i"))}
    else if(a==="hora"){sel.hora=b.getAttribute("data-v");ir("dados")}
    else if(a==="whats"){cliqueWhats();return}
    render();
  });
  // Falha ao registrar: o cliente ainda pode falar com a barbearia, sabendo que o pedido não ficou registrado
  $("agErro").addEventListener("click",function(e){if(e.target.closest("[data-ag='whats']"))cliqueWhats()});
  $("agEnviar").addEventListener("click",function(){
    if(enviando)return;
    var nome=$("agNome")?$("agNome").value.trim():"",obs=$("agObs")?$("agObs").value.trim():"";
    if(nome.length<2){$("agErro").textContent="Informe seu nome.";return}
    var peloClube=!!($("agClube")&&$("agClube").checked),zap=$("agWhats")?$("agWhats").value.trim():"";
    var novidades=!!($("agNovidades")&&$("agNovidades").checked),digitos=zap.replace(/\D/g,"");
    if(!semCadastro&&!demo&&(digitos.length<10||digitos.length>13)){$("agErro").textContent=digitos?"Confira seu WhatsApp: DDD e número.":"Informe seu WhatsApp com DDD: a barbearia usa para avisar se o seu horário mudar.";if($("agWhats"))$("agWhats").focus();return}
    if(peloClube&&digitos.length<10){$("agErro").textContent="Informe o WhatsApp do clube com DDD.";return}
    if(digitos&&(digitos.length<10||digitos.length>13)){$("agErro").textContent="Confira seu WhatsApp: DDD e número.";return}
    if(novidades&&!digitos){$("agErro").textContent="Para receber as novidades, informe seu WhatsApp.";return}
    if(semCadastro){concluir(nome,obs,{});return}
    if(demo){pilha=[];etapa="demo";render();return}
    var corpo={slug:C.slug,servico:nomeServicos(),profissional:sel.qualquer?"":sel.prof.nome,profissionalId:sel.qualquer?"":(sel.prof.dbId||""),qualquer:!!sel.qualquer,preco:sel.servico.preco||"",duracao:duracaoTotal(),dia:sel.diaISO,horario:sel.hora,cliente:nome,observacao:obs,website:$("agSite")?$("agSite").value:""};
    // Vários serviços com o plano (gerador v20): barbeiro e horário de cada um; sem agenda no banco, a lista (o servidor soma)
    if(sel.plano){
      corpo.itens=escolhidos().map(function(s,i){var x=sel.plano.itens[i]||{};return {servico:s.nome,preco:s.preco||"",duracao:duracaoDe(s),profissionalId:x.id,horario:x.horario}});
      corpo.profissionalId=sel.plano.itens[0].id;corpo.profissional=nomesDoPlano(sel.plano);corpo.qualquer=false;corpo.horario=sel.plano.horario;
    }else if(sel.mais&&sel.mais.length)corpo.servicos=escolhidos().map(function(s){return {nome:s.nome,preco:s.preco||""}});
    if(digitos){corpo.whatsapp=zap;corpo.novidades=novidades}
    if(peloClube){corpo.clube=true;corpo.clubeWhatsapp=zap}
    var botao=$("agEnviar"),rotulo=botao.querySelector("span"),original=rotulo?rotulo.textContent:"";
    enviando=true;botao.disabled=true;if(rotulo)rotulo.textContent="Enviando…";
    // Grava o pedido (pendente, ou já confirmado quando a barbearia confirma sozinha) e recebe o código; se o horário já foi ocupado, avisa e volta à escolha da hora
    fetch("/api/pedido",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(corpo)}).then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {status:r.status,ok:r.ok,j:j}})}).catch(function(){return {status:0,ok:false,j:{}}}).then(function(res){
      enviando=false;botao.disabled=false;if(rotulo)rotulo.textContent=original;
      if(res.status===409){$("agErro").textContent=res.j.message||"Este horário não está mais livre. Escolha outro.";sel.hora=null;sel.plano=null;cacheHoras={};etapa="dia";render();return}
      if(!res.ok&&res.j&&res.j.clube){$("agErro").textContent=res.j.message||"Não conseguimos conferir sua assinatura do clube.";return}
      if(!res.ok){
        var m=(res.j&&res.j.message)||(res.status===0?"Sem conexão com a internet.":"Não conseguimos registrar seu pedido agora.");
        $("agErro").innerHTML=esc(m)+" Seu pedido não foi registrado."+(whats()?'<br><button type="button" class="ag-op" data-ag="whats"><b>Falar com a barbearia no WhatsApp</b></button>':"");
        return;
      }
      if(res.j&&res.j.clube){try{localStorage.setItem("bio-clube-"+C.slug,zap)}catch(e){}}
      guardar("nome",nome);if(digitos)guardar("zap",zap);
      concluir(nome,obs,res.j||{});
    });
  });
  // Pedido feito: mostra o resumo (com o código, quando registrado) e abre o WhatsApp com a mensagem pronta
  function concluir(nome,obs,j){
    // O número vem do pedido recém-gravado (sem cache): a mensagem vai para o WhatsApp atual da barbearia
    if(j.whatsapp)trocarWhats(j.whatsapp);
    var cod=j.codigo||"";
    var quem=sel.plano?(j.profissional||nomesDoPlano(sel.plano)):sel.qualquer?(j.profissional||"Qualquer barbeiro disponível"):sel.prof.nome;
    var txt=(AG.msg||MSG_PADRAO).split("{servico}").join(nomeServicos()).split("{profissional}").join(quem).split("{dia}").join(sel.diaTxt).split("{horario}").join(sel.hora).split("{nome}").join(nome).split("{obs}").join(obs?"\nObs.: "+obs:"").split("{codigo}").join(cod);
    if(cod&&txt.indexOf(cod)<0)txt+="\nCódigo: "+cod;
    if(j.clube)txt+="\n*Assinante do clube*";
    if(j.confirmado){txt=txt.replace("Olá! Quero agendar:","Olá! Agendei pelo site:");txt+="\nHorário já confirmado pelo site."}
    var txtPago=j.sinal?"Olá! Paguei o sinal de R$ "+Number(j.sinal.valor).toFixed(2).replace(".",",")+" do meu agendamento (código "+cod+"): "+nomeServicos()+" com "+quem+", "+sel.diaTxt+" às "+sel.hora+".":"";
    ultimo={servico:nomeServicos(),quem:quem,diaTxt:sel.diaTxt,diaISO:sel.diaISO,hora:sel.hora,codigo:cod,duracao:sel.plano?minDe(sel.plano.fim)-minDe(sel.plano.horario):duracaoTotal(),clube:!!j.clube,confirmado:!!j.confirmado,link:linkWhats(txt),sinal:j.sinal||null,linkPago:j.sinal?linkWhats(txtPago):""};
    pilha=[];etapa="ok";render();
    // Quem já ligou os avisos neste celular: o pedido novo fica ligado sem tocar em nada
    var A=window.BioApp;
    if(cod&&A&&A.avisos.suportado()&&A.avisos.permissao()==="granted")A.avisos.ligar({codigo:cod}).then(function(){ultimo.avisos="ok"}).catch(function(){ultimo.avisos="erro"}).then(function(){if(etapa==="ok")render()});
    // Pedido que espera confirmação: o WhatsApp abre com a mensagem pronta. Confirmado ou com sinal a pagar: não abre
    if(!ultimo.confirmado&&!ultimo.sinal)abrirLink(ultimo.link);
  }
}

module.exports = { agendaRuntime };
