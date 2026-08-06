/* Enfoco CRM — módulo semáforo v3:
   (1) 4 calendarios por temperatura (Ex clientes / Calientes / Tibios; Seguimientos → Leads fríos)
   (2) Perfil compacto: semáforo + resumen + mensaje del asistente. Historial/nota/IA vieja tras "ver más".
   (3) Botón "Pasar a Clientes activos" (contrato firmado → no se le vende).
   (4) Menú limpio: oculta Panorama, Vistage, Tono IA, Tabla/Editar, Atrasados. Clientes → Clientes activos.
   (5) Analytics nuevo por segmento (pipeline por temperatura + outreach frío por canal). */
(function(){
  var DB='https://enfoco-crm-default-rtdb.firebaseio.com';
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
  function todayISO(){ return new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'}); }

  /* ============ (1) CALENDARIOS POR TEMPERATURA ============ */
  function wrapDrawWeek(){
    if(typeof window.drawWeek !== 'function' || window.drawWeek.__semaforo) return;
    var _dw = window.drawWeek;
    var wrapped = function(){
      if(!window.__tf) return _dw.apply(this, arguments);
      var bak = leads, f = {};
      try{
        for(var k in bak){
          if(k.indexOf('zz') === 0) continue;
          if(tempOf(bak[k]) === window.__tf) f[k] = bak[k];
        }
        leads = f;
        _dw.apply(this, arguments);
      } finally { leads = bak; }
      var d = null;
      for(var i=0;i<DEFS.length;i++) if(DEFS[i].key===window.__tf) d = DEFS[i];
      var t = document.getElementById('pgTitle');
      if(t && d) t.innerHTML = 'Plan <i>' + d.titulo + '</i>';
    };
    wrapped.__semaforo = true;
    window.drawWeek = wrapped;
  }

  /* ============ (4) MENÚ ============ */
  var HIDE_RE = /^(◆?\s*Panorama|🌐?\s*Vistage|🎙️?\s*Tono IA|📋?\s*Tabla\s*\/?\s*Editar|⏰?\s*Atrasad?os)$/;
  function cleanNav(){
    var items = document.querySelectorAll('.nav-link, .mnav-btn');
    for(var i=0;i<items.length;i++){
      var e = items[i];
      var t = e.textContent.replace(/\s+/g,' ').trim();
      if(HIDE_RE.test(t)) e.style.display = 'none';
      if(/^🤝?\s*Clientes$/.test(t)) e.innerHTML = e.innerHTML.replace('Clientes','Clientes activos');
    }
    var all = document.querySelectorAll('button, a, span, div');
    for(var j=0;j<all.length;j++){
      var el = all[j];
      if(el.childElementCount === 0 && el.textContent.trim() === 'Seguimientos') el.textContent = 'Leads fríos';
      else if(el.childElementCount <= 2 && /^📨?\s*Seguimientos$/.test(el.textContent.trim()) && el.textContent.length < 20)
        el.innerHTML = el.innerHTML.replace('📨','❄️').replace('Seguimientos','Leads fríos');
    }
  }

  function addButtons(){
    wrapDrawWeek();
    wrapPerfil();
    wrapAnalytics();
    cleanNav();
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
  }

  /* ============ (2)(3) PERFIL COMPACTO ============ */
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

  function oldSections(modal){
    var res = [];
    var o1 = document.getElementById('pf_resumen_sec'); if(o1) res.push(o1);
    var o2 = document.getElementById('pf_ai_sec'); if(o2) res.push(o2);
    var secs = modal.querySelectorAll('.msec');
    for(var i=0;i<secs.length;i++){
      var t = secs[i].textContent.replace(/\s+/g,' ').trim();
      if(/^Agregar nota/i.test(t) || /^Historial/i.test(t)) res.push(secs[i]);
    }
    return res;
  }

  function compactPerfil(id){
    var m = document.getElementById('mPerfil'); if(!m) return;
    var modal = m.firstElementChild; if(!modal) return;
    var l = (typeof leads !== 'undefined' && leads[id]) ? leads[id] : null; if(!l) return;
    var olds = oldSections(modal);
    for(var i=0;i<olds.length;i++) olds[i].style.display = 'none';
    var prev = document.getElementById('sf_perfil'); if(prev) prev.remove();

    var t = tempOf(l) || 'frio';
    var res = (l.resumen||'').trim();
    var dr = (l.borrador||'').trim();
    var ph = phoneDigits(l.wpp||'');
    var mail = ((l.mail||'').split('//')[0]||'').trim();
    var li = (l.linkedin||'').trim();
    var wa = ph ? ('https://wa.me/'+ph+(dr?('?text='+encodeURIComponent(dr)):'')) : '';
    var esCliente = (l.origen||'').toString().toLowerCase()==='cliente';

    var sec = document.createElement('div');
    sec.className = 'msec';
    sec.id = 'sf_perfil';
    var chipCss = 'display:inline-block;margin:0 6px 6px 0;padding:5px 11px;border-radius:9px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid #333;background:#1d1f26;color:#9a9890;';
    var chipOn = 'border-color:#d4b46a;color:#d4b46a;background:rgba(212,180,106,.1);';
    var btnCss = 'display:inline-block;margin:6px 6px 0 0;padding:9px 13px;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid #333;background:#1d1f26;color:#e8e6e1;text-decoration:none;';
    var html = '';
    if(!esCliente){
      html += '<div style="margin-bottom:8px">';
      ['ex','caliente','tibio','frio'].forEach(function(k){
        html += '<span data-sftemp="'+k+'" style="'+chipCss+(k===t?chipOn:'')+'">'+TN[k]+'</span>';
      });
      html += '</div>';
    } else {
      html += '<div style="margin-bottom:8px"><span style="'+chipCss+'border-color:rgba(87,180,106,.5);color:#7ed194;cursor:default">🤝 CLIENTE ACTIVO — no se le vende</span></div>';
    }
    html += '<div style="font-size:13px;line-height:1.55;color:#e8e6e1;margin-bottom:6px;max-width:640px">'+
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
    if(dr && !l.aprobado && !esCliente) html += '<span id="sf_approve" style="'+btnCss+'border-color:rgba(212,180,106,.4);color:#d4b46a">🤖 Mandalo vos</span>';
    if(l.aprobado) html += '<span style="'+btnCss+'border-color:rgba(87,180,106,.4);color:#7ed194;cursor:default">✓ Aprobado ('+esc(l.aprobado)+')</span>';
    if(!esCliente) html += '<span id="sf_cliente" style="'+btnCss+'border-color:rgba(87,180,106,.35);color:#7ed194">🤝 Pasar a Clientes activos</span>';
    html += '</div>';
    html += '<div id="sf_toggle" style="margin-top:10px;font-size:11px;color:#9a9890;cursor:pointer;user-select:none">▾ Ver ficha completa (historial, notas, IA vieja)</div>';
    sec.innerHTML = html;

    var ref = modal.children[2] || null;
    modal.insertBefore(sec, ref);

    sec.querySelectorAll('[data-sftemp]').forEach(function(ch){
      ch.addEventListener('click', function(){
        var nt = ch.getAttribute('data-sftemp');
        fetch(DB+'/leads/'+id+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},
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
      fetch(DB+'/leads/'+id+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({aprobado:canal,aprobadoTs:Date.now(),_lastEdit:Date.now()})}).then(function(r){
          if(r.ok){ l.aprobado = canal; compactPerfil(id); }
        });
    });
    var pc = document.getElementById('sf_cliente');
    if(pc) pc.addEventListener('click', function(){
      if(!confirm('¿Pasar "'+(l.empresa||'')+'" a CLIENTES ACTIVOS?\nMientras esté ahí no se le manda nada comercial. Cuando termine el trabajo, volvé a pasarlo a Ex-cliente.')) return;
      var hist = Array.isArray(l.historial) ? l.historial.slice() : [];
      hist.push({fecha:todayISO(), contenido:'Pasado a Clientes activos (contrato en marcha). Se pausa todo contacto comercial.'});
      var body = {origen:'cliente', historial:hist, borrador:'', aprobado:'', proxPaso:'Cliente activo — sin acciones comerciales.', _lastEdit:Date.now()};
      fetch(DB+'/leads/'+id+'.json',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)}).then(function(r){
          if(r.ok){ Object.assign(l, body); compactPerfil(id);
            try{ if(typeof drawAll==='function') drawAll(); else drawWeek(); }catch(e){} }
        });
    });
    var tg = document.getElementById('sf_toggle');
    if(tg) tg.addEventListener('click', function(){
      var hidden = olds.length && olds[0].style.display === 'none';
      for(var i=0;i<olds.length;i++) olds[i].style.display = hidden ? '' : 'none';
      tg.textContent = hidden ? '▴ Ocultar ficha completa' : '▾ Ver ficha completa (historial, notas, IA vieja)';
    });
  }

  /* ============ (5) ANALYTICS POR SEGMENTO ============ */
  function wrapAnalytics(){
    if(typeof window.goPanel !== 'function' || window.goPanel.__semaforo) return;
    var _gp = window.goPanel;
    var wrapped = function(name, el){
      var r = _gp.apply(this, arguments);
      if(name === 'analytics') setTimeout(drawAnalyticsV2, 120);
      return r;
    };
    wrapped.__semaforo = true;
    window.goPanel = wrapped;
  }

  function drawAnalyticsV2(){
    var panel = document.getElementById('panel-analytics'); if(!panel) return;
    var hoy = todayISO();
    var segs = {ex:{n:0,atr:0,cola:0,draft:0,apr:0}, caliente:{n:0,atr:0,cola:0,draft:0,apr:0},
                tibio:{n:0,atr:0,cola:0,draft:0,apr:0}, frio:{n:0,atr:0,cola:0,draft:0,apr:0}};
    var clientes=0, perdidos=0;
    for(var k in leads){
      if(k.indexOf('zz')===0) continue;
      var l = leads[k]; if(!l||typeof l!=='object') continue;
      var o=(l.origen||'').toString().toLowerCase(), e=(l.estado||'').toString().toLowerCase();
      if(o==='cliente'){ clientes++; continue; }
      if(e==='perdido'||e==='no-potencial'){ perdidos++; continue; }
      var t = tempOf(l)||'frio'; var s = segs[t]; if(!s) continue;
      s.n++;
      var pf=(l.proxFecha||'').slice(0,10);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(pf) || pf<hoy) s.atr++;
      else if(pf===hoy) s.cola++;
      if((l.borrador||'').trim()) s.draft++;
      if(l.aprobado) s.apr++;
    }
    fetch(DB+'/outreach.json').then(function(r){return r.json();}).then(function(o){
      o = o||{};
      var ch = {mail:{env:0,seg:0,resp:0,otros:0}, linkedin:{env:0,seg:0,resp:0,otros:0}};
      for(var k in o){
        var rec=o[k]; if(!rec||typeof rec!=='object') continue;
        var c = (rec.canal==='linkedin')?'linkedin':'mail';
        var st=(rec.estado||'').toString().toLowerCase();
        if(st==='enviado') ch[c].env++;
        else if(st==='seguimiento_enviado') ch[c].seg++;
        else if(st.indexOf('respond')===0||st==='respondio') ch[c].resp++;
        else ch[c].otros++;
      }
      render(ch);
    }).catch(function(){ render(null); });

    function card(t, big, sub, color){
      return '<div style="background:#17181d;border:1px solid #262933;border-left:3px solid '+color+';border-radius:13px;padding:14px 16px;min-width:150px;flex:1">'+
        '<div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9a9890">'+t+'</div>'+
        '<div style="font-size:26px;font-weight:700;color:#e8e6e1;margin:4px 0 2px">'+big+'</div>'+
        '<div style="font-size:11px;color:#9a9890;line-height:1.5">'+sub+'</div></div>';
    }
    function render(ch){
      var C={ex:'#d4b46a',caliente:'#e0704f',tibio:'#dfa93d',frio:'#5f8dd3'};
      var html='<div style="padding:22px;max-width:1100px">';
      html+='<div style="font-size:18px;font-weight:700;color:#e8e6e1;margin-bottom:4px">Analytics del pipeline</div>';
      html+='<div style="font-size:12px;color:#9a9890;margin-bottom:16px">Por segmento del semáforo · actualizado ahora · '+clientes+' clientes activos · '+perdidos+' perdidos</div>';
      html+='<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px">';
      html+=card('⭐ Ex clientes', segs.ex.n, segs.ex.atr+' atrasados · '+segs.ex.draft+' con mensaje listo'+(segs.ex.apr?' · '+segs.ex.apr+' aprobados':''), C.ex);
      html+=card('🔥 Calientes', segs.caliente.n, segs.caliente.atr+' atrasados · '+segs.caliente.draft+' con mensaje listo'+(segs.caliente.apr?' · '+segs.caliente.apr+' aprobados':''), C.caliente);
      html+=card('🌡️ Tibios', segs.tibio.n, segs.tibio.atr+' atrasados · '+segs.tibio.draft+' con mensaje listo'+(segs.tibio.apr?' · '+segs.tibio.apr+' aprobados':''), C.tibio);
      html+=card('❄️ Fríos (pipeline)', segs.frio.n, segs.frio.atr+' atrasados', C.frio);
      html+='</div>';
      if(ch){
        var totM=ch.mail.env+ch.mail.seg+ch.mail.resp+ch.mail.otros;
        var totL=ch.linkedin.env+ch.linkedin.seg+ch.linkedin.resp+ch.linkedin.otros;
        var trM=totM?Math.round(ch.mail.resp*100/totM):0;
        var trL=totL?Math.round(ch.linkedin.resp*100/totL):0;
        html+='<div style="font-size:13px;font-weight:700;color:#e8e6e1;margin:8px 0 10px">Outreach frío (envíos masivos)</div>';
        html+='<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px">';
        html+=card('✉️ Cancillería (mail)', totM, ch.mail.resp+' respondieron ('+trM+'%) · '+ch.mail.seg+' con seguimiento · '+ch.mail.env+' esperando', '#7ed194');
        html+=card('in Vistage (LinkedIn)', totL, totL? (ch.linkedin.resp+' respondieron ('+trL+'%) · '+ch.linkedin.seg+' con seguimiento · '+ch.linkedin.env+' esperando') : 'Se empieza a cargar con los próximos envíos', '#6fa8dc');
        html+='</div>';
      }
      html+='<div style="font-size:11px;color:#9a9890">Los interesados de los envíos fríos suben solos al pipeline (tibio/caliente). El detalle fino lo tenés en el panel y en el chat con el asistente.</div>';
      html+='</div>';
      panel.innerHTML = html;
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButtons);
  else addButtons();
  setTimeout(addButtons, 1200);
  setTimeout(addButtons, 3500);
})();
