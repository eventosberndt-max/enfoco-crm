/* Enfoco CRM — módulo semáforo v2:
   (1) 4 calendarios por temperatura en la columna izquierda (Ex clientes / Calientes / Tibios; Seguimientos → Leads fríos)
   (2) Tarjeta de perfil compacta: semáforo + resumen + mensaje del asistente, secciones viejas de IA ocultas tras "ver más".
   No modifica la lógica existente del CRM: solo envuelve drawWeek y abrirPerfil. */
(function(){
  var DB='https://enfoco-crm-default-rtdb.firebaseio.com/leads';
  var DEFS = [
    { key:'ex',       icon:'⭐', label:'Ex clientes',     titulo:'Ex Clientes' },
    { key:'caliente', icon:'🔥', label:'Leads calientes', titulo:'Leads Calientes' },
    { key:'tibio',    icon:'🌡️', label:'Leads tibios',   titulo:'Leads Tibios' }
  ];
  var TN={ex:'⭐ EX-CLIENTE',caliente:'🔥 CALIENTE',tibio:'🌡️ TIBIO',frio:'❄️ FRÍO'};
  window.__tf = null;

  function tempOf(l){
    if(!l || typeof l !== 'object') return null;
    if(l.temp) return l.temp;
    var o = (l.origen||'').toString().toLowerCase();
    if(o === 'enfoco' || o === 'referenciado') return 'ex';
    return 'frio';
  }
  function esc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }
  function phoneDigits(w){
    var d=(w||'').replace(/\D/g,'');
    if(!d||d.length<8) return '';
    if(d.indexOf('549')===0) return d;
    if(d.indexOf('54')===0) return '549'+d.slice(2);
    if(d.length===10&&(d.indexOf('11')===0||d[0]==='2'||d[0]==='3')) return '549'+d;
    return d;
  }

  /* ============ (1) CALENDARIOS POR TEMPERATURA ============ */
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
    wrapPerfil();
    var btns = document.querySelectorAll('[onclick*="goPanel(\'semana\'"]');
    for(var b=0;b<btns.length;b++){
      var btn = btns[b];
      if(btn.dataset.semaforoDone) continue;
      btn.dataset.semaforoDone = '1';
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
    var all = document.querySelectorAll('button, a, span, div');
    for(var j=0;j<all.length;j++){
      var e = all[j];
      if(e.childElementCount === 0 && e.textContent.trim() === 'Seguimientos') e.textContent = 'Leads fríos';
      else if(e.childElementCount <= 2 && /^📨?\s*Seguimientos$/.test(e.textContent.trim()) && e.textContent.length < 20)
        e.innerHTML = e.innerHTML.replace('📨','❄️').replace('Seguimientos','Leads fríos');
    }
  }

  /* ============ (2) PERFIL COMPACTO ============ */
  function wrapPerfil(){
    if(typeof window.abrirPerfil !== 'function' || window.abrirPerfil.__semaforo) return;
    var _ap = window.abrirPerfil;
    var wrapped = function(id){
      var r = _ap.apply(this, arguments);
      try{ setTimeout(function(){ compactPerfil(id); }, 80); }catch(e){}
      return r;
    };
    wrapped.__semaforo = true;
    window.abrirPerfil = wrapped;
  }

  function compactPerfil(id){
    var m = document.getElementById('mPerfil'); if(!m) return;
    var modal = m.firstElementChild; if(!modal) return;
    var l = (typeof leads !== 'undefined' && leads[id]) ? leads[id] : null; if(!l) return;
    var old1 = document.getElementById('pf_resumen_sec');
    var old2 = document.getElementById('pf_ai_sec');
    if(old1) old1.style.display = 'none';
    if(old2) old2.style.display = 'none';
    var prev = document.getElementById('sf_perfil'); if(prev) prev.remove();

    var t = tempOf(l) || 'frio';
    var res = (l.resumen||'').trim();
    var dr = (l.borrador||'').trim();
    var ph = phoneDigits(l.wpp||'');
    var mail = ((l.mail||'').split('//')[0]||'').trim();
    var li = (l.linkedin||'').trim();
    var wa = ph ? ('https://wa.me/'+ph+(dr?('?text='+encodeURIComponent(dr)):'')) : '';

    var sec = document.createElement('div');
    sec.className = 'msec';
    sec.id = 'sf_perfil';
    var chipCss = 'display:inline-block;margin:0 6px 6px 0;padding:5px 11px;border-radius:9px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid #333;background:#1d1f26;color:#9a9890;';
    var chipOn = 'border-color:#d4b46a;color:#d4b46a;background:rgba(212,180,106,.1);';
    var btnCss = 'display:inline-block;margin:6px 6px 0 0;padding:9px 13px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #333;background:#1d1f26;color:#e8e6e1;text-decoration:none;';
    var html = '';
    html += '<div style="margin-bottom:8px">';
    ['ex','caliente','tibio','frio'].forEach(function(k){
      html += '<span data-sftemp="'+k+'" style="'+chipCss+(k===t?chipOn:'')+'">'+TN[k]+'</span>';
    });
    html += '</div>';
    html += '<div style="font-size:13px;line-height:1.5;color:#e8e6e1;margin-bottom:6px">'+
      (res ? '💬 '+esc(res) : '<span style="color:#9a9890">Sin resumen aún — lo completa el asistente.</span>')+'</div>';
    if(dr){
      html += '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#9a9890;margin:8px 0 4px">Mensaje propuesto por el asistente</div>';
      html += '<div id="sf_draft" style="background:#1d1f26;border:1px solid #333;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5;white-space:pre-wrap;color:#e8e6e1">'+esc(dr)+'</div>';
    }
    html += '<div>';
    if(dr) html += '<span id="sf_copy" style="'+btnCss+'">📋 Copiar</span>';
    if(wa) html += '<a href="'+esc(wa)+'" target="_blank" rel="noopener" style="'+btnCss+'border-color:rgba(87,180,106,.4);color:#7ed194">WhatsApp</a>';
    if(mail) html += '<a href="mailto:'+esc(mail)+'" style="'+btnCss+'">✉️ Mail</a>';
    if(li) html += '<a href="'+esc(li)+'" target="_blank" rel="noopener" style="'+btnCss+'border-color:rgba(111,168,220,.4);color:#6fa8dc">in LinkedIn</a>';
    if(dr && !l.aprobado) html += '<span id="sf_approve" style="'+btnCss+'border-color:rgba(212,180,106,.4);color:#d4b46a">🤖 Mandalo vos</span>';
    if(l.aprobado) html += '<span style="'+btnCss+'border-color:rgba(87,180,106,.4);color:#7ed194;cursor:default">✓ Aprobado ('+esc(l.aprobado)+')</span>';
    html += '</div>';
    html += '<div id="sf_toggle" style="margin-top:10px;font-size:11px;color:#9a9890;cursor:pointer;user-select:none">▾ Ver secciones viejas (IA interna)</div>';
    sec.innerHTML = html;

    var ref = modal.children[2] || null;
    modal.insertBefore(sec, ref);

    sec.querySelectorAll('[data-sftemp]').forEach(function(ch){
      ch.addEventListener('click', function(){
        var nt = ch.getAttribute('data-sftemp');
        fetch(DB+'/'+id+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({temp:nt,_lastEdit:Date.now()})}).then(function(r){
            if(r.ok){ l.temp = nt; compactPerfil(id); try{ if(window.__tf) drawWeek(); }catch(e){} }
          });
      });
    });
    var cp = document.getElementById('sf_copy');
    if(cp) cp.addEventListener('click', function(){
      try{ navigator.clipboard.writeText(dr); cp.textContent='✓ Copiado';
        setTimeout(function(){ cp.textContent='📋 Copiar'; },1500); }catch(e){}
    });
    var ap = document.getElementById('sf_approve');
    if(ap) ap.addEventListener('click', function(){
      var canal = ph ? 'wpp' : (mail ? 'mail' : (li ? 'linkedin' : ''));
      if(!canal) return;
      if(!confirm('El asistente manda este mensaje tal cual por '+canal+' a '+(l.empresa||'')+'. ¿Confirmás?')) return;
      fetch(DB+'/'+id+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({aprobado:canal,aprobadoTs:Date.now(),_lastEdit:Date.now()})}).then(function(r){
          if(r.ok){ l.aprobado = canal; compactPerfil(id); }
        });
    });
    var tg = document.getElementById('sf_toggle');
    if(tg) tg.addEventListener('click', function(){
      var hidden = old1 && old1.style.display === 'none';
      if(old1) old1.style.display = hidden ? '' : 'none';
      if(old2) old2.style.display = hidden ? '' : 'none';
      tg.textContent = hidden ? '▴ Ocultar secciones viejas' : '▾ Ver secciones viejas (IA interna)';
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons);
  else addButtons();
  setTimeout(addButtons, 1200);
  setTimeout(addButtons, 3500);
})();
