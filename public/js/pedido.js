// MORFI - Pedido Online (WhatsApp / Instagram)
function pdM(v){return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",minimumFractionDigits:0}).format(v||0);}
function pdE(s){if(s==null)return"";return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// Desde Morfi Nube la página vive en /l/<local>/: la API también
const PD_API=(location.pathname.match(/^\/l\/[^/]+/)||[""])[0];

const PedidoOnline={
  categorias:[],productos:[],carrito:[],catActiva:"todas",origen:"web",config:{},
  // Desde el QR de una mesa: clave de la mesa y su estado (pedidos enviados, cuenta)
  mesaToken:"",mesa:null,

  async init(){
    const p=new URLSearchParams(location.search);
    const o=p.get("origen")||"web";
    this.origen=["whatsapp","instagram","web"].includes(o)?o:"web";
    this.mesaToken=/^[a-f0-9]{24}$/.test(p.get("mesa")||"")?p.get("mesa"):"";
    if(!this.mesaToken)this._badge();
    try{
      const[m,info,mesa]=await Promise.all([
        fetch(PD_API+"/api/publico/menu").then(r=>r.json()),
        fetch(PD_API+"/api/publico/info").then(r=>r.json()).catch(()=>({})),
        this.mesaToken?fetch(PD_API+"/api/publico/mesa/"+this.mesaToken).then(r=>r.ok?r.json():null):null
      ]);
      if(this.mesaToken&&!mesa){
        document.getElementById("menuItems").innerHTML='<div class="menu-empty"><i class="fas fa-exclamation-triangle"></i><p>Este QR no corresponde a ninguna mesa. Pedile ayuda al mozo.</p></div>';
        return;
      }
      this.categorias=m.categorias||[];
      this.productos=m.productos||[];
      this.config=info;
      if(info.nombre){document.getElementById("negocioNombre").textContent=info.nombre;document.title="Pedido | "+info.nombre;}
      if(info.descripcion)document.getElementById("negocioSub").textContent=info.descripcion;
      if(mesa)this._iniciarMesa(mesa);
      if(info.recibe_pedidos===false&&info.aviso){const av=document.createElement("div");av.className="mesa-seguimiento";av.textContent=info.aviso;document.getElementById("menuItems").before(av);}
      if(info.telefono){
        const wa=document.getElementById("confirmacionWA");
        if(wa){wa.href="https://wa.me/"+info.telefono.replace(/\D/g,"");wa.style.display="";}
      }
      this.paintCats();this.paintItems();this._initEvents();
    }catch(err){
      document.getElementById("menuItems").innerHTML='<div class="menu-empty"><i class="fas fa-exclamation-triangle"></i><p>No se pudo cargar el menu.</p></div>';
    }
  },

  // ── Pedido desde la mesa ──
  _iniciarMesa(estado){
    const b=document.getElementById("origenBadge");
    if(b){b.innerHTML='<i class="fas fa-chair"></i> '+pdE(estado.mesa.nombre);b.className="origen-badge-hero badge-web";b.style.display="";}
    document.getElementById("negocioSub").textContent=estado.modo==="solo_carta"
      ?"Mirá la carta y llamá al mozo cuando quieras pedir"
      :"Elegí, enviá tu pedido y el mozo lo confirma";
    document.getElementById("mesaPanel").style.display="";
    // Formulario: no hace falta teléfono ni tipo de entrega; el nombre es opcional
    ["grupoTelefono","grupoTipo","grupoDireccion"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});
    document.getElementById("clienteTelefono").required=false;
    document.getElementById("clienteNombre").required=false;
    document.getElementById("labelNombre").textContent="Tu nombre (opcional)";
    ["btnConfirmar","btnConfirmarMobile"].forEach(id=>{const e=document.getElementById(id);if(e)e.innerHTML='<i class="fas fa-paper-plane"></i> Enviar al mozo';});
    this._pintarMesa(estado);
    // El cliente ve cuándo el mozo confirma: se consulta cada 10 s mientras la página está a la vista
    setInterval(()=>{if(!document.hidden)this._refrescarMesa();},10000);
    // Vuelta de Mercado Pago: ?pago=<intento>&payment_id=...&status=...
    const q=new URLSearchParams(location.search);
    if(/^\d+$/.test(q.get("pago")||""))this._volverDePago(q.get("pago"),q.get("payment_id")||q.get("collection_id")||"",q.get("status")||q.get("collection_status")||"");
  },

  // ── Pagar desde la mesa ──
  pagoOpc:{modo:"todo",partes:2,propina:0,propinaOtra:""},
  abrirCuenta(){
    const e=this.mesa||{};const c=e.cuenta;
    // Sin cuenta abierta o sin Mercado Pago: se avisa al mozo como antes
    if(!c||!(c.saldo>0)){this.llamar("cuenta");return;}
    this._pintarPago();
    document.getElementById("pagoModal").style.display="";document.body.style.overflow="hidden";
  },
  cerrarCuenta(){document.getElementById("pagoModal").style.display="none";document.body.style.overflow="";},
  _calcPago(){
    const c=this.mesa.cuenta,o=this.pagoOpc;
    const n=Math.max(2,Math.min(20,parseInt(o.partes,10)||2));
    const parte=o.modo==="todo"?c.saldo:Math.min(c.saldo,Math.ceil(c.saldo/n*100)/100);
    const propina=o.propina==="otra"?Math.max(0,Math.round((parseFloat(String(o.propinaOtra).replace(",","."))||0)*100)/100):Math.round(parte*o.propina)/100;
    return{n,parte,propina,total:Math.round((parte+propina)*100)/100};
  },
  _pintarPago(){
    const e=this.mesa,c=e.cuenta,o=this.pagoOpc,k=this._calcPago();
    const chip=(v,l)=>`<button type="button" class="pago-chip ${o.propina===v?"activo":""}" onclick="PedidoOnline.opcPago('propina',${JSON.stringify(v)})">${l}</button>`;
    const mp=e.pago&&e.pago.mercadopago?`
      <div class="pago-seccion">
        <h4><i class="fas fa-mobile-alt"></i> Pagar ahora con Mercado Pago</h4>
        <label class="tipo-opcion"><input type="radio" name="pagoModo" ${o.modo==="todo"?"checked":""} onchange="PedidoOnline.opcPago('modo','todo')"><span>Toda la cuenta</span></label>
        <label class="tipo-opcion"><input type="radio" name="pagoModo" ${o.modo==="partes"?"checked":""} onchange="PedidoOnline.opcPago('modo','partes')"><span>Mi parte: dividir entre
          <input type="number" id="pagoPartes" min="2" max="20" value="${k.n}" onchange="PedidoOnline.opcPago('partes',this.value)" onfocus="PedidoOnline.elegirPartes()" onclick="event.stopPropagation()" class="pago-partes"> personas</span></label>
        <div class="pago-propina"><span>Propina para el equipo</span><div>${chip(0,"Sin propina")}${chip(10,"10%")}${chip(15,"15%")}${chip("otra","Otra")}</div>
          ${o.propina==="otra"?`<input type="number" id="pagoPropinaOtra" min="0" step="1" placeholder="$" value="${pdE(o.propinaOtra)}" oninput="PedidoOnline.opcPago('propinaOtra',this.value,true)">`:""}</div>
        <div class="resumen-row"><span>${o.modo==="todo"?"Cuenta":"Tu parte"}</span><strong>${pdM(k.parte)}</strong></div>
        ${k.propina?`<div class="resumen-row"><span>Propina</span><strong>${pdM(k.propina)}</strong></div>`:""}
        <div class="resumen-total"><span>Pagás</span><strong id="pagoTotal">${pdM(k.total)}</strong></div>
        <button class="btn btn-primary btn-block mt-10" id="btnPagarMP" onclick="PedidoOnline.pagarMP()"><i class="fas fa-lock"></i> Pagar ${pdM(k.total)} con Mercado Pago</button>
      </div>`:"";
    document.getElementById("pagoContenido").innerHTML=`
      <div class="form-resumen">
        <div class="resumen-row"><span>Total de la mesa</span><strong>${pdM(c.total)}</strong></div>
        ${c.pagado?`<div class="resumen-row"><span>Ya pagado</span><strong>-${pdM(c.pagado)}</strong></div>`:""}
        <div class="resumen-total"><span>Falta pagar</span><strong>${pdM(c.saldo)}</strong></div>
      </div>
      ${mp}
      <div class="pago-seccion">
        <h4>${mp?"¿Pagás de otra forma?":"¿Cómo pagás?"} Te traemos la cuenta</h4>
        <div class="mesa-acciones">
          <button class="btn btn-outline" onclick="PedidoOnline.cuentaAlMozo('efectivo')"><i class="fas fa-money-bill-wave"></i> Efectivo</button>
          <button class="btn btn-outline" onclick="PedidoOnline.cuentaAlMozo('tarjeta')"><i class="fas fa-credit-card"></i> Tarjeta</button>
        </div>
      </div>`;
  },
  // Tocar la cantidad de personas elige "Mi parte" (si no, seguía cobrando la cuenta entera)
  elegirPartes(){
    if(this.pagoOpc.modo==="partes")return;
    this.pagoOpc.modo="partes";this._pintarPago();
    const i=document.getElementById("pagoPartes");i.focus();i.select();
  },
  // sinRepintar: al escribir la propina no se rehace el formulario (se perdería el foco)
  opcPago(campo,valor,sinRepintar){
    this.pagoOpc[campo]=valor;
    if(!sinRepintar)return this._pintarPago();
    const k=this._calcPago();
    document.getElementById("pagoTotal").textContent=pdM(k.total);
    document.getElementById("btnPagarMP").innerHTML='<i class="fas fa-lock"></i> Pagar '+pdM(k.total)+" con Mercado Pago";
  },
  async pagarMP(){
    const o=this.pagoOpc,k=this._calcPago();
    const btn=document.getElementById("btnPagarMP");btn.disabled=true;
    btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Abriendo Mercado Pago...';
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pagar",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({partes:o.modo==="todo"?1:k.n,propina:k.propina})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo iniciar el pago");
      location.href=d.link;
    }catch(err){alert(err.message);this._pintarPago();}
  },
  async cuentaAlMozo(forma){
    this.cerrarCuenta();
    await this.llamar("cuenta",forma);
    this._aviso("Listo: el mozo te trae la cuenta.");
  },
  _aviso(texto){
    const a=document.getElementById("mesaAviso");
    a.textContent=texto;a.style.display="";
    clearTimeout(this._avisoTimer);this._avisoTimer=setTimeout(()=>{a.style.display="none";},15000);
  },
  async _volverDePago(id,paymentId,status){
    history.replaceState(null,"",location.pathname+"?mesa="+this.mesaToken);
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pago/"+id+"/verificar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({payment_id:paymentId})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo verificar el pago");
      if(d.estado==="aprobado"){
        this._aviso("¡Pago aprobado! Gracias."+(d.cuenta_cerrada?" La cuenta quedó paga.":" Falta pagar el resto de la mesa."));
        this._pintarComprobante(id,d);
      }else{
        this._aviso(status==="pending"||status==="in_process"
          ?"Tu pago está en proceso: cuando Mercado Pago lo apruebe, se acredita solo."
          :"El pago no se completó. Podés intentar de nuevo o pedirle la cuenta al mozo.");
      }
      this._refrescarMesa();
    }catch(err){this._aviso(err.message);}
  },
  // Comprobante por WhatsApp para quien pagó (sale cuando se cierra la cuenta de la mesa)
  _pintarComprobante(id,d){
    const el=document.getElementById("mesaComprobante");
    if(!this.mesa||!this.mesa.pago||!this.mesa.pago.whatsapp){el.innerHTML="";return;}
    if(d.comprobante){
      el.innerHTML=`<div class="mesa-seguimiento"><i class="fab fa-whatsapp"></i> ${d.comprobante==="enviado"?"Te mandamos el comprobante por WhatsApp.":"Te mandamos el comprobante por WhatsApp cuando se pague toda la cuenta."}</div>`;
      return;
    }
    el.innerHTML=`<form class="mesa-seguimiento" onsubmit="PedidoOnline.pedirComprobante(event,${Number(id)})">
      <h4><i class="fab fa-whatsapp"></i> ¿Querés el comprobante por WhatsApp?</h4>
      <div class="mesa-acciones"><input type="tel" id="comprobanteTel" placeholder="11 1234-5678" required autocomplete="tel">
      <button class="btn btn-success" id="btnComprobante">Enviarme</button></div></form>`;
  },
  async pedirComprobante(e,id){
    e.preventDefault();
    const btn=document.getElementById("btnComprobante");btn.disabled=true;
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pago/"+id+"/comprobante",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({telefono:document.getElementById("comprobanteTel").value})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo enviar");
      this._pintarComprobante(id,d);
    }catch(err){alert(err.message);btn.disabled=false;}
  },
  async _refrescarMesa(){
    try{const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken);if(r.ok)this._pintarMesa(await r.json());}catch(e){}
  },
  _pintarMesa(estado){
    this.mesa=estado;
    const ESTADOS={pendiente:"Esperando al mozo",confirmada:"Confirmado, en preparación",rechazada:"No se pudo tomar",atendida:"El mozo ya viene"};
    const TITULOS={pedido:"Pedido",mozo:"Llamaste al mozo",cuenta:"Pediste la cuenta"};
    // Los avisos de pago son para el mozo; el cliente ve lo pagado en la cuenta
    const sols=(estado.solicitudes||[]).filter(s=>TITULOS[s.tipo]).slice(0,6).map(s=>{
      const det=s.tipo==="pedido"?" — "+s.items.map(i=>i.cantidad+" x "+i.nombre).join(", "):"";
      const est=s.tipo!=="pedido"&&s.estado==="pendiente"?"Avisado":ESTADOS[s.estado]||s.estado;
      return`<div class="mesa-sol"><span>${pdE(TITULOS[s.tipo]+det)}${s.motivo?`<br><small>${pdE(s.motivo)}</small>`:""}</span><span class="mesa-sol-estado ${pdE(s.estado)}">${pdE(est)}</span></div>`;
    }).join("");
    const c=estado.cuenta;
    const cuenta=c?`<div class="mesa-seguimiento"><h4><i class="fas fa-receipt"></i> Tu cuenta</h4>
      ${c.items.map(i=>`<div class="mesa-sol"><span>${pdE(i.cantidad+" x "+i.nombre_producto)}</span><span>${pdM(i.subtotal)}</span></div>`).join("")}
      ${c.descuento?`<div class="mesa-sol"><span>Descuento</span><span>-${pdM(c.descuento)}</span></div>`:""}
      ${c.propina?`<div class="mesa-sol"><span>Propina</span><span>${pdM(c.propina)}</span></div>`:""}
      <div class="mesa-cuenta-total"><span>Total</span><span>${pdM(c.total)}</span></div>
      ${c.pagado?`<div class="mesa-sol"><span>Pagado</span><span>-${pdM(c.pagado)}</span></div>
      <div class="mesa-cuenta-total"><span>Falta pagar</span><span>${pdM(c.saldo)}</span></div>`:""}</div>`:"";
    document.getElementById("mesaEstado").innerHTML=(sols?`<div class="mesa-seguimiento"><h4><i class="fas fa-bell"></i> Tus pedidos</h4>${sols}</div>`:"")+cuenta;
    // Solo carta: se ve el menú pero no se arma pedido
    if(estado.modo==="solo_carta"){["carritoSidebar","carritoFlotante"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});}
  },
  async llamar(tipo,forma){
    const btn=document.getElementById(tipo==="cuenta"?"btnPedirCuenta":"btnLlamarMozo");
    btn.disabled=true;
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/llamar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tipo,forma})});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||"No se pudo avisar");
      await this._refrescarMesa();
    }catch(err){alert(err.message);}
    finally{setTimeout(()=>{btn.disabled=false;},5000);}
  },

  _badge(){
    const b=document.getElementById("origenBadge");if(!b)return;
    const m={whatsapp:{icon:"fab fa-whatsapp",label:"Pedido por WhatsApp",cls:"badge-wa"},instagram:{icon:"fab fa-instagram",label:"Pedido por Instagram",cls:"badge-ig"},web:{icon:"fas fa-globe",label:"Pedido Online",cls:"badge-web"}};
    const i=m[this.origen]||m.web;
    b.innerHTML=`<i class="${i.icon}"></i> ${i.label}`;
    b.className="origen-badge-hero "+i.cls;b.style.display="";
  },

  catIcon(n){
    n=(n||"").toLowerCase();
    if(n.includes("entrada"))return"fa-utensils";
    if(n.includes("plato")||n.includes("principal"))return"fa-drumstick-bite";
    if(n.includes("bebida")||n.includes("gaseosa"))return"fa-glass-martini-alt";
    if(n.includes("postre")||n.includes("helado"))return"fa-ice-cream";
    if(n.includes("cafe"))return"fa-mug-hot";
    return"fa-tag";
  },

  paintCats(){
    const mk=(id,lbl)=>`<button class="menu-cat-btn ${this.catActiva==id?"active":""}" onclick="PedidoOnline.setCat(${JSON.stringify(id)})">${pdE(lbl)}</button>`;
    const h=[mk("todas","Todas"),...this.categorias.map(c=>mk(c.id,c.nombre))].join("");
    ["menuCategorias","mobileCatScroll"].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=h;});
  },

  setCat(id){this.catActiva=id;this.paintCats();this.paintItems();},
  visible(p){return p.tracking_stock?(p.stock_actual>0||p.es_plato===1):true;},
  itemCard(p){
    const q=(this.carrito.find(i=>i.producto_id===p.id)||{cantidad:0}).cantidad;
    const qc=this.mesa&&this.mesa.modo==="solo_carta"?""
      :q===0
      ?`<button class="btn-agregar" onclick="PedidoOnline.agregar(${p.id})" aria-label="Agregar"><i class="fas fa-plus"></i> Agregar</button>`
      :`<button class="btn-qty btn-qty-minus" onclick="PedidoOnline.quitar(${p.id})" aria-label="Quitar">&#8722;</button><span class="qty-num">${q}</span><button class="btn-qty btn-qty-plus" onclick="PedidoOnline.agregar(${p.id})" aria-label="Sumar">+</button>`;
    return `<div class="menu-item-card pedido-item-card" data-id="${p.id}">
  <div class="menu-item-info">
    <div class="menu-item-nombre">${pdE(p.nombre)}</div>
    ${p.descripcion?`<div class="menu-item-desc">${pdE(p.descripcion)}</div>`:""}
    <div class="menu-item-precio">${pdM(p.precio_venta)}</div>
  </div>
  <div class="item-qty-ctrl">${qc}</div>
</div>`;
  },

  paintItems(){
    const el=document.getElementById("menuItems");
    const vis=this.productos.filter(p=>this.visible(p));
    const sec=(cat,prods)=>{
      if(!prods.length)return"";
      return`<div class="menu-section"><div class="menu-section-title"><i class="fas ${this.catIcon(cat.nombre)}"></i> ${pdE(cat.nombre)}</div>${prods.map(p=>this.itemCard(p)).join("")}</div>`;
    };
    if(this.catActiva==="todas"){
      el.innerHTML=this.categorias.map(c=>sec(c,vis.filter(p=>p.categoria_id==c.id))).join("")||'<div class="menu-empty">No hay productos.</div>';
    }else{
      const cat=this.categorias.find(c=>c.id==this.catActiva);
      const items=vis.filter(p=>p.categoria_id==this.catActiva);
      el.innerHTML=cat?sec(cat,items)||'<div class="menu-empty">Sin productos en esta categoria.</div>':'<div class="menu-empty">Categoria no encontrada.</div>';
    }
  },

  agregar(id){
    const prod=this.productos.find(p=>p.id===id);if(!prod)return;
    const item=this.carrito.find(i=>i.producto_id===id);
    if(item)item.cantidad++;
    else this.carrito.push({producto_id:id,nombre:prod.nombre,precio:prod.precio_venta,cantidad:1,notas:""});
    this.paintItems();this.paintCarrito();
  },

  quitar(id){
    const idx=this.carrito.findIndex(i=>i.producto_id===id);if(idx===-1)return;
    this.carrito[idx].cantidad--;
    if(this.carrito[idx].cantidad<=0)this.carrito.splice(idx,1);
    this.paintItems();this.paintCarrito();
  },

  eliminar(id){
    this.carrito=this.carrito.filter(i=>i.producto_id!==id);
    this.paintItems();this.paintCarrito();
  },

  _carritoHTML(){
    if(!this.carrito.length)return'<div class="carrito-vacio"><i class="fas fa-shopping-bag"></i><p>Todavia no agregaste nada</p></div>';
    return this.carrito.map(i=>`<div class="carrito-item">
  <div class="carrito-item-info"><span class="carrito-item-nombre">${pdE(i.nombre)}</span><span class="carrito-item-precio">${pdM(i.precio)}</span></div>
  <div class="carrito-item-qty">
    <button class="btn-qty btn-qty-minus" onclick="PedidoOnline.quitar(${i.producto_id})" aria-label="Quitar">&#8722;</button>
    <span>${i.cantidad}</span>
    <button class="btn-qty btn-qty-plus" onclick="PedidoOnline.agregar(${i.producto_id})" aria-label="Sumar">+</button>
    <button class="btn-qty btn-qty-remove" onclick="PedidoOnline.eliminar(${i.producto_id})" aria-label="Eliminar"><i class="fas fa-trash-alt"></i></button>
  </div>
  <div class="carrito-item-sub">${pdM(i.precio*i.cantidad)}</div>
</div>`).join("");
  },

  paintCarrito(){
    const total=this.carrito.reduce((s,i)=>s+i.precio*i.cantidad,0);
    const count=this.carrito.reduce((s,i)=>s+i.cantidad,0);
    const html=this._carritoHTML();
    const has=this.carrito.length>0;
    const set=(id,val,prop)=>{const e=document.getElementById(id);if(e){if(prop==="html")e.innerHTML=val;else if(prop==="display")e.style.display=val;else if(prop==="text")e.textContent=val;}};
    set("carritoItems",html,"html");set("carritoTotalRow",has?"":"none","display");set("carritoTotal",pdM(total),"text");
    set("btnConfirmar",has?"":"none","display");set("carritoCount",count+(count===1?" item":" items"),"text");
    set("carritoItemsMobile",html,"html");set("carritoTotalRowMobile",has?"":"none","display");set("carritoTotalMobile",pdM(total),"text");
    set("btnConfirmarMobile",has?"":"none","display");
    set("carritoFlotante",has?"":"none","display");set("carritoFlotanteCount",String(count),"text");
  },
  toggleCarritoMobile(){
    const m=document.getElementById("carritoMobileModal");if(!m)return;
    const open=m.style.display!=="none";
    m.style.display=open?"none":"";
    document.body.style.overflow=open?"":"hidden";
  },
  abrirFormulario(){
    const mm=document.getElementById("carritoMobileModal");
    if(mm)mm.style.display="none";
    this._paintResumen();
    const fm=document.getElementById("formModal");
    if(fm){fm.style.display="";document.body.style.overflow="hidden";}
  },
  cerrarFormulario(){
    const fm=document.getElementById("formModal");
    if(fm)fm.style.display="none";
    document.body.style.overflow="";
  },
  onTipoChange(v){
    const gd=document.getElementById("grupoDireccion");if(!gd)return;
    gd.style.display=v==="delivery"?"":"none";
    const dir=document.getElementById("clienteDireccion");
    if(dir)dir.required=v==="delivery";
  },
  _paintResumen(){
    const el=document.getElementById("formResumen");if(!el)return;
    const total=this.carrito.reduce((s,i)=>s+i.precio*i.cantidad,0);
    el.innerHTML='<div class="resumen-titulo">Resumen del pedido</div>'
      +this.carrito.map(i=>`<div class="resumen-row"><span>${pdE(i.nombre)} x${i.cantidad}</span><strong>${pdM(i.precio*i.cantidad)}</strong></div>`).join("")
      +`<div class="resumen-total"><span>Total estimado</span><strong>${pdM(total)}</strong></div>`;
  },
  async enviarPedido(e){
    e.preventDefault();
    const nombre=document.getElementById("clienteNombre").value.trim();
    const tel=document.getElementById("clienteTelefono").value.trim();
    const tipo=(document.querySelector('input[name="tipoPedido"]:checked')||{value:"takeaway"}).value;
    const dir=document.getElementById("clienteDireccion").value.trim();
    const notas=document.getElementById("clienteNotas").value.trim();
    if(this.mesaToken)return this._enviarMesa(nombre,notas);
    if(!nombre||!tel){alert("Completa nombre y telefono.");return;}
    if(tipo==="delivery"&&!dir){alert("Completa la direccion de entrega.");return;}
    if(!this.carrito.length){alert("Agrega al menos un producto.");return;}
    const btn=document.getElementById("btnEnviar");
    btn.disabled=true;
    btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Enviando...';
    try{
      const r=await fetch(PD_API+"/api/publico/pedido",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({cliente:nombre,telefono:tel,tipo,direccion:dir,notas,origen:this.origen,
          items:this.carrito.map(i=>({producto_id:i.producto_id,nombre:i.nombre,cantidad:i.cantidad,notas:i.notas||""}))})
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||"Error al enviar");
      this._confirmar(data,nombre);
      if(data.pendiente)this._seguirNube(data.codigo,nombre);
    }catch(err){
      alert("Error: "+err.message);
      btn.disabled=false;
      btn.innerHTML='<i class="fas fa-paper-plane"></i> Enviar pedido';
    }
  },
  // Por Morfi Nube el pedido llega al local en unos segundos: el cliente ve cuándo lo recibió y con qué número
  _seguirNube(codigo,nombre){
    const msg=document.getElementById("confirmacionMsg"),num=document.getElementById("confirmacionNumero");
    const tit=document.getElementById("confirmacionTitulo"),titulo=t=>{if(tit)tit.textContent=t;};
    titulo("Pedido enviado");
    if(msg)msg.textContent="Enviando tu pedido al local...";
    if(num)num.innerHTML='<i class="fas fa-spinner fa-spin"></i>';
    const hasta=Date.now()+35*60000;
    const mirar=async()=>{
      try{
        const r=await fetch(PD_API+"/api/publico/pedido/"+codigo);const d=await r.json();
        if(d.estado==="recibido"){
          titulo("Pedido recibido!");
          if(msg)msg.textContent="Gracias "+nombre+"! El local recibió tu pedido y en breve te contactamos.";
          if(num)num.innerHTML="Numero de pedido: <strong>"+pdE(d.numero_pedido)+"</strong>";
          return;
        }
        if(d.estado!=="pendiente"){titulo("No se pudo tomar el pedido");if(msg)msg.textContent=d.mensaje||"El local no pudo tomar el pedido.";if(num)num.innerHTML="";return;}
      }catch(e){}
      if(Date.now()<hasta)setTimeout(mirar,4000);
    };
    mirar();
  },
  async _enviarMesa(nombre,notas){
    if(!this.carrito.length){alert("Agrega al menos un producto.");return;}
    const btn=document.getElementById("btnEnviar");
    btn.disabled=true;
    btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Enviando...';
    try{
      const r=await fetch(PD_API+"/api/publico/mesa/"+this.mesaToken+"/pedido",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({cliente:nombre,notas,items:this.carrito.map(i=>({producto_id:i.producto_id,cantidad:i.cantidad,notas:i.notas||""}))})
      });
      const data=await r.json();
      if(!r.ok)throw new Error(data.error||"Error al enviar");
      this._confirmar(data,nombre);
      this._refrescarMesa();
    }catch(err){
      alert("Error: "+err.message);
      btn.disabled=false;
      btn.innerHTML='<i class="fas fa-paper-plane"></i> Enviar pedido';
    }
  },
  _confirmar(data,nombre){
    document.getElementById("formModal").style.display="none";
    document.body.style.overflow="";
    const msg=document.getElementById("confirmacionMsg");
    const num=document.getElementById("confirmacionNumero");
    if(this.mesaToken){
      // Desde la mesa no se tapa la carta: el cliente sigue viendo sus pedidos, la cuenta y puede pedir más.
      // En modo directo ya está en cocina; si no, espera al mozo.
      const aviso=document.getElementById("mesaAviso");
      aviso.textContent=data.estado==="confirmada"
        ?"¡Listo"+(nombre?" "+nombre:"")+"! Tu pedido ya está en preparación."
        :"¡Gracias"+(nombre?" "+nombre:"")+"! El mozo lo confirma en un momento: abajo ves cuándo pasa a cocina.";
      aviso.style.display="";
      setTimeout(()=>{aviso.style.display="none";},15000);
      this.carrito=[];
      const form=document.getElementById("pedidoForm");if(form)form.reset();
      const btn=document.getElementById("btnEnviar");
      if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-paper-plane"></i> Enviar pedido';}
      this.paintItems();this.paintCarrito();
      document.getElementById("mesaPanel").scrollIntoView({behavior:"smooth"});
      return;
    }
    if(msg)msg.textContent="Gracias "+nombre+"! Recibimos tu pedido y en breve te contactamos.";
    if(num)num.innerHTML="Numero de pedido: <strong>"+pdE(data.numero_pedido)+"</strong>";
    document.getElementById("confirmacionScreen").style.display="";
    ["menuItems","menuCategorias"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="none";});
    const sb=document.getElementById("carritoSidebar");if(sb)sb.style.display="none";
    const fl=document.getElementById("carritoFlotante");if(fl)fl.style.display="none";
    const nav=document.getElementById("mobileCatNav");if(nav)nav.style.display="none";
  },
  nuevoPedido(){
    this.carrito=[];
    document.getElementById("confirmacionScreen").style.display="none";
    ["menuItems","menuCategorias"].forEach(id=>{const e=document.getElementById(id);if(e)e.style.display="";});
    const sb=document.getElementById("carritoSidebar");if(sb)sb.style.display="";
    const nav=document.getElementById("mobileCatNav");if(nav)nav.style.display="";
    const form=document.getElementById("pedidoForm");if(form)form.reset();
    // El botón quedaba en "Enviando..." deshabilitado y no se podía mandar otro pedido sin recargar
    const btn=document.getElementById("btnEnviar");
    if(btn){btn.disabled=false;btn.innerHTML='<i class="fas fa-paper-plane"></i> Enviar pedido';}
    const gd=document.getElementById("grupoDireccion");if(gd)gd.style.display="none";
    this.paintItems();this.paintCarrito();
  },
  _initEvents(){
    ["carritoMobileModal","formModal","pagoModal"].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.addEventListener("click",e=>{
        if(e.target===el){
          if(id==="carritoMobileModal")this.toggleCarritoMobile();
          else if(id==="pagoModal")this.cerrarCuenta();
          else this.cerrarFormulario();
        }
      });
    });
    document.addEventListener("keydown",e=>{
      if(e.key!=="Escape")return;
      this.cerrarFormulario();
      if(this.mesaToken)this.cerrarCuenta();
      const mm=document.getElementById("carritoMobileModal");
      if(mm&&mm.style.display!=="none")this.toggleCarritoMobile();
    });
  }
};
document.addEventListener("DOMContentLoaded",()=>PedidoOnline.init());