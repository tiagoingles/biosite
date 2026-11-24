// Script do site publicado: carrinho, busca de produtos e envio do pedido pelo WhatsApp.
// Roda dentro do site publicado: o gerador serializa esta função com toString(). Ela não pode usar nada de fora dela.
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
  function tipo(){var r=document.querySelector('input[name="tipo"]:checked');if(r)return r.value;return O.entrega&&!O.retirada?"entrega":(O.retirada&&!O.entrega?"retirada":"")}
  // Bairros de entrega (com taxa). Sem lista cadastrada, vale a taxa única.
  function bairros(){return Array.isArray(O.bairros)?O.bairros.filter(function(b){return b&&b.nome}):[]}
  function bairroSel(){var el=$("fBairro");if(!el||!bairros().length)return null;var v=el.value.trim().toLowerCase();return bairros().find(function(b){return b.nome.toLowerCase()===v})||null}
  function taxa(){if(tipo()!=="entrega")return 0;var t=bairros().length?num((bairroSel()||{}).taxa):num(O.taxa);return isNaN(t)?0:t}
  function taxaTxt(){if(tipo()!=="entrega")return "";if(bairros().length&&!bairroSel())return "escolha o bairro";var t=bairros().length?num(bairroSel().taxa):num(O.taxa);return isNaN(t)?"a combinar":(t?brl(t):"grátis")}
  function aoTrocarLocal(){var r=document.querySelector('input[name="local"]:checked');var apto=!!r&&r.value==="apto";$("eCasa").hidden=apto;$("eApto").hidden=!apto}
  function ctl(id){var q=cart[id]||0;if(!q)return '<button type="button" class="add" data-add="'+id+'" aria-label="Adicionar">+</button>';return '<span class="step"><button type="button" data-sub="'+id+'" aria-label="Tirar um">−</button><b>'+q+'</b><button type="button" data-add="'+id+'" aria-label="Mais um">+</button></span>'}
  function renderSheet(){
    var h="";for(var i in cart){var p=P[i],pr=num(p.preco);
      h+='<div class="it"><div class="it-n"><b>'+esc(p.nome)+'</b><small>'+(isNaN(pr)?"Preço a combinar":brl(pr*cart[i]))+'</small></div>'+ctl(i)+'</div>'}
    $("itens").innerHTML=h;
    var sub=subtotal(),tx=taxa(),t="";
    t+='<div><span>Subtotal</span><span>'+brl(sub)+'</span></div>';
    if(tipo()==="entrega")t+='<div><span>Entrega</span><span>'+esc(taxaTxt())+'</span></div>';
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
  // Lupa: esconde os produtos que não batem com o que a pessoa digitou
  var lupa=document.getElementById("busca");
  if(lupa){
    var semAcento=function(t){return String(t).normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase()};
    lupa.addEventListener("input",function(){
      var q=semAcento(lupa.value.trim()),achou=0;
      document.querySelectorAll(".cat").forEach(function(sec){
        var n=0;
        sec.querySelectorAll(".prod").forEach(function(a){var ok=!q||semAcento(a.textContent).indexOf(q)>-1;a.hidden=!ok;if(ok)n++});
        sec.hidden=!n;achou+=n;
      });
      var chipsNav=document.querySelector(".chips");if(chipsNav)chipsNav.hidden=!!q;
      var vazia=document.getElementById("buscaVazia");if(vazia)vazia.hidden=!q||achou>0;
    });
  }
  document.addEventListener("change",function(e){if(e.target.name==="tipo")renderSheet();if(e.target.name==="local")aoTrocarLocal()});
  document.addEventListener("input",function(e){if(e.target.id==="fBairro")renderSheet()});
  $("enviar").addEventListener("click",function(){
    var nome=$("fNome").value.trim(),tp=tipo(),pag=$("fPag")?$("fPag").value:"",obs=$("fObs").value.trim(),quando=$("fQuando")?$("fQuando").value.trim():"";
    var bairro=$("fBairro")?$("fBairro").value.trim():"",rua=$("fRua")?$("fRua").value.trim():"",cidade=$("fCidade")?$("fCidade").value.trim():"",ref=$("fRef")?$("fRef").value.trim():"";
    var lr=document.querySelector('input[name="local"]:checked'),apto=!!lr&&lr.value==="apto",num_=$("fNum")?$("fNum").value.trim():"",cond=$("fCond")?$("fCond").value.trim():"",bloco=$("fBloco")?$("fBloco").value.trim():"",ap=$("fApto")?$("fApto").value.trim():"";
    var sub=subtotal(),min=num(O.minimo),err="";
    if(!nome)err="Informe seu nome.";
    else if(!tp&&(O.entrega||O.retirada))err="Escolha como receber: entrega ou retirada.";
    else if(O.agendamento&&!quando)err="Informe o dia e o horário que você prefere.";
    else if(tp==="entrega"&&!bairro)err="Informe o bairro de entrega.";
    else if(tp==="entrega"&&bairros().length&&!bairroSel())err="Escolha um bairro da lista de entrega.";
    else if(tp==="entrega"&&!rua)err="Informe a rua.";
    else if(tp==="entrega"&&!apto&&!num_)err="Informe o número da casa.";
    else if(tp==="entrega"&&apto&&(!cond||!bloco||!ap))err="Informe o condomínio, o bloco e o apartamento.";
    else if(!isNaN(min)&&sub<min)err="O pedido mínimo é "+brl(min)+".";
    $("erro").textContent=err;if(err)return;
    var L=["*"+(O.agendamento?"Agendamento":"Pedido")+" pelo site - "+C.nome+"*",""];
    for(var i in cart){var p=P[i],pr=num(p.preco);L.push(cart[i]+"x "+p.nome+(isNaN(pr)?"":" — "+brl(pr*cart[i])))}
    L.push("");L.push("Subtotal: "+brl(sub));
    if(tp==="entrega")L.push("Entrega ("+bairro+"): "+taxaTxt());
    L.push("*Total: "+brl(sub+taxa())+"*");L.push("");
    L.push("Nome: "+nome);
    if(quando)L.push("Dia e horário: "+quando);
    if(tp==="entrega"){L.push("*Endereço de entrega*");L.push("Bairro: "+bairro);L.push("Rua: "+rua);if(cidade)L.push("Cidade: "+cidade);if(apto){L.push("Condomínio: "+cond);L.push("Bloco: "+bloco);L.push("Apto: "+ap)}else L.push("Nº: "+num_);if(ref)L.push("Referência: "+ref)}
    else if(tp)L.push("Vou retirar no local");
    if(pag)L.push("Pagamento: "+pag);
    if(obs)L.push("Obs.: "+obs);
    var w=String(C.whatsapp||"").replace(/\D/g,"");if(w.indexOf("55")!==0)w="55"+w;
    var a=document.createElement("a");a.href="https://wa.me/"+w+"?text="+encodeURIComponent(L.join("\n"));a.target="_blank";a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
  });
  sync();
}

module.exports = { bioRuntime };
