/* Enfoco CRM — módulo semáforo: 4 calendarios por temperatura en la columna izquierda.
   No modifica la lógica existente: envuelve drawWeek con un filtro por campo `temp`
   y clona el botón "Semana" en Ex clientes / Leads calientes / Leads tibios.
   "Seguimientos" pasa a llamarse "Leads fríos" (misma tabla). */
(function(){
  var DEFS = [
    { key:'ex',       icon:'⭐', label:'Ex clientes',     titulo:'Ex Clientes' },
    { key:'caliente', icon:'🔥', label:'Leads calientes', titulo:'Leads Calientes' },
    { key:'tibio',    icon:'🌡️', label:'Leads tibios',   titulo:'Leads Tibios' }
  ];
  window.__tf = null;

  function tempOf(l){
    if(!l || typeof l !== 'object') return null;
    if(l.temp) return l.temp;
    var o = (l.origen||'').toString().toLowerCase();
    if(o === 'enfoco' || o === 'referenciado') return 'ex';
    return 'frio';
  }

  // Envolver drawWeek: si hay filtro activo, dibuja solo los leads de esa temperatura
  function wrapDrawWeek(){
    if(typeof window.drawWeek !== 'function' || window.drawWeek.__semaforo) return;
    var _dw = window.drawWeek;
    var wrapped = function(){
      if(!window.__tf) return _dw.apply(this, arguments);
      /* 'leads' es un binding global del script del CRM (let), no window.leads */
      var bak = leads, f = {};
      try{
        for(var k in bak){
          if(k.indexOf('zz') === 0) continue;
          if(tempOf(bak[k]) === window.__tf) f[k] = bak[k];
        }
        leads = f;
        _dw.apply(this, arguments);
      } finally {
        leads = bak;
      }
      var d = null;
      for(var i=0;i<DEFS.length;i++) if(DEFS[i].key===window.__tf) d = DEFS[i];
      var t = document.getElementById('pgTitle');
      if(t && d) t.innerHTML = 'Plan <i>' + d.titulo + '</i>';
    };
    wrapped.__semaforo = true;
    window.drawWeek = wrapped;
  }

  function addButtons(){
    wrapDrawWeek();
    var btns = document.querySelectorAll('[onclick*="goPanel(\'semana\'"]');
    for(var b=0;b<btns.length;b++){
      var btn = btns[b];
      if(btn.dataset.semaforoDone) continue;
      btn.dataset.semaforoDone = '1';
      // Semana original limpia el filtro
      btn.addEventListener('click', function(){ window.__tf = null;
        var t=document.getElementById('pgTitle'); if(t) t.innerHTML='Plan <i>Semanal</i>'; });
      var after = btn;
      for(var i=0;i<DEFS.length;i++){
        (function(def){
          var c = btn.cloneNode(true);
          c.removeAttribute('id');
          c.classList.remove('on');
          c.removeAttribute('onclick');
          c.dataset.tf = def.key;
          try{ c.innerHTML = c.innerHTML.replace('📅', def.icon).replace('Semana', def.label); }
          catch(e){ c.textContent = def.icon + ' ' + def.label; }
          c.addEventListener('click', function(){
            window.__tf = def.key;
            try{ goPanel('semana', this); }catch(e){}
            try{ if(typeof syncMobileNav === 'function') syncMobileNav('semana'); }catch(e){}
            try{ drawWeek(); }catch(e){}
          });
          after.insertAdjacentElement('afterend', c);
          after = c;
        })(DEFS[i]);
      }
    }
    // Renombrar "Seguimientos" → "Leads fríos" en cualquier menú
    var all = document.querySelectorAll('button, a, span, div');
    for(var j=0;j<all.length;j++){
      var e = all[j];
      if(e.childElementCount === 0 && e.textContent.trim() === 'Seguimientos') e.textContent = 'Leads fríos';
      else if(e.childElementCount <= 2 && /^📨?\s*Seguimientos$/.test(e.textContent.trim()) && e.textContent.length < 20)
        e.innerHTML = e.innerHTML.replace('📨','❄️').replace('Seguimientos','Leads fríos');
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons);
  else addButtons();
  setTimeout(addButtons, 1200);
  setTimeout(addButtons, 3500);
})();
