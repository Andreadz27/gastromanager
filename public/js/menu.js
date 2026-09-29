// GASTROMANAGER - Menu Publico (carta QR)

function menuMoneda(v){return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',minimumFractionDigits:0}).format(v||0);}
function menuEsc(s){if(s===null||s===undefined)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');}

const MenuPublico={
  categorias:[],productos:[],catActiva:'todas',
  async init(){
    const fy=document.getElementById('footerYear');if(fy)fy.textContent=new Date().getFullYear();
    try{
      const[data,cfg]=await Promise.all([fetch('/api/publico/menu').then(r=>{if(!r.ok)throw new Error(r.status);return r.json();}),fetch('/api/publico/info').then(r=>r.json()).catch(()=>null)]);
      this.categorias=data.categorias||[];this.productos=data.productos||[];
      if(cfg&&cfg.nombre){
        const h=document.getElementById('menuRestNombre'),sb=document.getElementById('menuRestSub'),fd=document.getElementById('footerDireccion'),ft=document.getElementById('footerTelefono');
        if(h)h.textContent=cfg.nombre;if(sb)sb.textContent=cfg.descripcion||'';
        if(fd&&cfg.descripcion)fd.textContent=cfg.descripcion.replace('Dirección: ','');
        if(ft&&cfg.telefono){ft.textContent=cfg.telefono;ft.href='tel:'+cfg.telefono;}
      }
      this.paintCategorias();this.paintItems();
    }catch(err){
      const el=document.getElementById('menuItems');
      if(el)el.innerHTML='<div class="menu-empty"><i class="fas fa-exclamation-circle"></i><p>No se pudo cargar el menú.</p></div>';
      console.error('[MenuPublico]',err);
    }
  },
  catIcon(nombre){
    const n=(nombre||'').toLowerCase();
    if(n.includes('entrada')||n.includes('entrante'))return 'fa-utensils';
    if(n.includes('plato')||n.includes('principal')||n.includes('parrilla'))return 'fa-drumstick-bite';
    if(n.includes('alcoh')||n.includes('vino')||n.includes('cerveza'))return 'fa-wine-glass';
    if(n.includes('bebida')||n.includes('gaseosa')||n.includes('jugo'))return 'fa-glass-water';
    if(n.includes('postre')||n.includes('dulce')||n.includes('torta')||n.includes('helado'))return 'fa-ice-cream';
    if(n.includes('delivery')||n.includes('domicilio')||n.includes('llevar'))return 'fa-motorcycle';
    if(n.includes('ensalada')||n.includes('verdura')||n.includes('saludable'))return 'fa-leaf';
    if(n.includes('desayuno')||n.includes('cafe')||n.includes('café'))return 'fa-mug-hot';
    if(n.includes('sandwich')||n.includes('burger')||n.includes('hambur'))return 'fa-burger';
    if(n.includes('pizza')||n.includes('empanada'))return 'fa-pizza-slice';
    return 'fa-tag';
  },
  paintCategorias(){
    const d=document.getElementById('menuCategorias'),m=document.getElementById('mobileCatScroll');
    const btn=(id,lbl,icon)=>{const a=this.catActiva==id?'active':'';return '<button class="menu-cat-btn '+a+'" data-id="'+id+'"><i class="fas '+icon+'"></i> '+menuEsc(lbl)+'</button>';};
    const all=[btn('todas','Todas','fa-border-all')].concat(this.categorias.map(c=>btn(c.id,c.nombre,this.catIcon(c.nombre)))).join('');
    const bind=(ct,mob)=>{ct.querySelectorAll('[data-id]').forEach(b=>{b.addEventListener('click',()=>{this.catActiva=b.getAttribute('data-id');this.paintCategorias();this.paintItems();if(mob){const mc=document.getElementById('menuContainer');if(mc)mc.scrollIntoView({behavior:'smooth'});}});});};
    if(d){d.innerHTML=all||'<button class="menu-cat-btn active">Menú</button>';bind(d,false);}
    if(m){m.innerHTML=all.replace(/menu-cat-btn/g,'mobile-cat-btn');bind(m,true);}
  },
  itemCard(p){
    const desc=p.descripcion?'<div class="menu-item-desc">'+menuEsc(p.descripcion)+'</div>':'';
    return '<article class="menu-item-card"><div class="menu-item-header"><div class="menu-item-info"><div class="menu-item-nombre">'+menuEsc(p.nombre)+'</div>'+desc+'</div><div class="menu-item-precio">'+menuMoneda(p.precio_venta)+'</div></div></article>';
  },
  sectionBlock(cat,prods){
    if(!prods.length)return '';
    return '<section class="menu-section reveal"><div class="menu-section-title"><i class="fas '+this.catIcon(cat.nombre)+'"></i> '+menuEsc(cat.nombre)+'</div>'+prods.map(p=>this.itemCard(p)).join('')+'</section>';
  },
  visible(p){return p.tracking_stock?(p.stock_actual>0||p.es_plato===1):true;},
  paintItems(){
    const el=document.getElementById('menuItems');if(!el)return;
    const vis=this.productos.filter(p=>this.visible(p));
    if(this.catActiva==='todas'){
      const html=this.categorias.map(c=>this.sectionBlock(c,vis.filter(p=>p.categoria_id==c.id))).join('');
      el.innerHTML=html||'<div class="menu-empty"><i class="fas fa-utensils"></i><p>No hay productos disponibles.</p></div>';
    }else{
      const cat=this.categorias.find(c=>c.id==this.catActiva),items=vis.filter(p=>p.categoria_id==this.catActiva);
      if(!cat)el.innerHTML='<div class="menu-empty"><i class="fas fa-search"></i><p>Categoría no encontrada.</p></div>';
      else el.innerHTML=this.sectionBlock(cat,items)||'<div class="menu-empty"><i class="fas fa-box-open"></i><p>No hay productos en esta categoría.</p></div>';
    }
    this.setupReveal();
  },
  setupReveal(){
    const items=document.querySelectorAll('.reveal:not(.visible)');if(!items.length)return;
    if('IntersectionObserver'in window){
      const obs=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');obs.unobserve(e.target);}});},{threshold:0.08,rootMargin:'0px 0px -30px 0px'});
      items.forEach(el=>obs.observe(el));
    }else{items.forEach(el=>el.classList.add('visible'));}
  }
};

document.addEventListener('DOMContentLoaded',()=>MenuPublico.init());