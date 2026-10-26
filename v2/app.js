(function () {
  'use strict';
  var CFG = window.ENFOCO_CONFIG, D = window.EnfocoData;
  var app = document.getElementById('app');
  var S = { user: null, token: null, raw: {}, M: null, fin: null, errors: [], loading: false, verPausa: false, filtro: { q: '', etapa: '', camp: '' } };
  var TOKEN_KEY = 'enfoco_drive_token';

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function miles(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function money(n, cur) { return n == null ? '—' : '<span class="cur">' + cur + '</span>' + miles(n); }
  function millones(n) { return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1).replace('.', ',') + ' M'; }
  function fdate(d) { if (!d) return '—'; return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + (d.getFullYear() !== new Date().getFullYear() ? '/' + String(d.getFullYear()).slice(2) : ''); }
  function pct(a, b) { return b ? Math.round(a * 100 / b) + '%' : '—'; }
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 4000); }
  function ring(n, total, color, size) {
    size = size || 104; var r = size * 0.385, c = 2 * Math.PI * r, f = total ? Math.min(1, n / total) * c : 0;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true">' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="#343A50" stroke-width="5"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + f.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/>' +
      '<text x="50%" y="' + (size / 2 + size * 0.09) + '" text-anchor="middle" fill="#E6E8EF" font-family="Barlow" font-size="' + Math.round(size * 0.27) + '">' + n + '</text></svg>';
  }
  function stateTag(p) { return '<span class="state" style="color:' + p.estadoColor + ';background:' + p.estadoColor + '22">' + esc(p.estado) + '</span>'; }
  var ETAPA_COLOR = { 'Contactado': '#8A90A6', 'Sin respuesta': '#7D8299', 'Rebotado': '#7D8299', 'Respondió': '#F2A93B', 'Reunión': '#4FB8A8', 'Presupuesto': '#F2A93B', 'En pausa': '#8C90CF', 'Ganado': '#E6E8EF', 'Perdido': '#E8604C' };
  function etapaTag(e) { var c = ETAPA_COLOR[e] || '#8A90A6'; return '<span class="state" style="color:' + c + ';background:' + c + '22">' + esc(e) + '</span>'; }

  // ---------- autenticación ----------
  firebase.initializeApp(CFG.firebase);
  var auth = firebase.auth(), db = firebase.database();
  var provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');
  provider.setCustomParameters({ prompt: 'select_account', login_hint: CFG.allowedEmails[0] });

  function permitido(u) { return u && u.email && CFG.allowedEmails.indexOf(u.email.toLowerCase()) >= 0; }

  function login() {
    auth.signInWithPopup(provider).then(function (res) {
      if (!permitido(res.user)) { auth.signOut(); renderLogin('Esa cuenta no tiene acceso. Entrá con ' + CFG.allowedEmails[0] + '.'); return; }
      guardarToken(res.credential && res.credential.accessToken);
    }).catch(function (e) { renderLogin('No se pudo entrar: ' + (e.message || e.code)); });
  }
  function guardarToken(t) {
    if (!t) return;
    S.token = t;
    try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ t: t, exp: Date.now() + 55 * 60000 })); } catch (e) {}
  }
  function tokenGuardado() {
    try { var x = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); return x && x.exp > Date.now() ? x.t : null; } catch (e) { return null; }
  }
  function reconectarDrive() {
    auth.currentUser.reauthenticateWithPopup(provider).then(function (res) {
      guardarToken(res.credential && res.credential.accessToken); cargar();
    }).catch(function (e) { toast('No se pudo reconectar: ' + (e.message || e.code)); });
  }
  window._enfoco = { login: login, salir: function () { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} auth.signOut(); }, reconectar: reconectarDrive };

  auth.onAuthStateChanged(function (u) {
    if (!u) { S.user = null; renderLogin(); return; }
    if (!permitido(u)) { auth.signOut(); renderLogin('Esa cuenta no tiene acceso.'); return; }
    S.user = u; S.token = S.token || tokenGuardado();
    cargar();
  });

  // ---------- carga ----------
  function driveXlsx(id) {
    return fetch('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media', { headers: { Authorization: 'Bearer ' + S.token } })
      .then(function (r) {
        if (r.status === 401) throw Object.assign(new Error('La conexión con Drive venció'), { drive401: true });
        if (!r.ok) throw new Error('Drive respondió ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) { return XLSX.read(buf, { type: 'array', cellDates: true }); });
  }
  function leer(path) { return db.ref(path).once('value').then(function (s) { return s.val() || {}; }); }

  function cargar() {
    S.loading = true; S.errors = []; render();
    var hoy = new Date();
    var pFire = Promise.all([leer('leads'), leer('outreach'), leer('crm/seguimientos').catch(function () { return {}; })])
      .then(function (r) { S.raw.leads = r[0]; S.raw.outreach = r[1]; S.raw.seg = r[2]; })
      .catch(function (e) { S.errors.push('Firebase: ' + e.message); });
    var pCrm = !S.token ? Promise.resolve(S.errors.push('drive')) : driveXlsx(CFG.sheets.crm).then(function (wb) {
      S.raw.presupuestos = D.parsePresupuestos(wb, hoy); S.raw.posibles = D.parsePosibles(wb, hoy);
    }).catch(function (e) { S.errors.push(e.drive401 ? 'drive' : 'Planilla de presupuestos: ' + e.message); });
    var pFin = !S.token ? Promise.resolve() : driveXlsx(CFG.sheets.finanzas).then(function (wb) { S.fin = D.parseFinanzas(wb); })
      .catch(function (e) { S.errors.push(e.drive401 ? 'drive' : 'Ganancias y pérdidas: ' + e.message); });
    Promise.all([pFire, pCrm, pFin]).then(function () {
      S.M = D.buildModel({ hoy: hoy, leads: S.raw.leads, outreach: S.raw.outreach, presupuestos: S.raw.presupuestos || [], posibles: S.raw.posibles || [], seguimientos: S.raw.seg || {} });
      S.loading = false; render();
    });
  }

  function sumarSeguimiento(id) {
    var p = S.M.presupuestos.filter(function (x) { return x.id === id; })[0];
    db.ref('crm/seguimientos/' + id).push({ fecha: Date.now(), por: S.user.email, empresa: p ? p.empresa : '' })
      .then(function () { if (p) p.seguimientos++; (S.raw.seg[id] = S.raw.seg[id] || {})[Date.now()] = 1; toast('Seguimiento anotado'); render(); })
      .catch(function (e) { toast('No se pudo guardar: ' + e.message); });
  }

  // ---------- pantallas ----------
  function shell(body, on) {
    var links = [['tablero', 'Tablero'], ['campanas', 'Campañas'], ['contactos', 'Contactos'], ['presupuestos', 'Presupuestos'], ['finanzas', 'Finanzas']];
    var drive = S.errors.indexOf('drive') >= 0 ? '<div class="notice" style="margin:0 40px">Las planillas no se pudieron leer porque la conexión con Google Drive venció. <button class="btn sm" data-act="reconectar">Reconectar Drive</button></div>' : '';
    var otros = S.errors.filter(function (e) { return e !== 'drive'; }).map(function (e) { return '<div class="notice" style="margin:12px 40px 0">' + esc(e) + '</div>'; }).join('');
    return '<header class="top"><div class="brand"><span class="dot"></span><b>ENFOCO</b><span class="cond mut small">CRM</span></div>' +
      '<nav class="main" aria-label="Secciones">' + links.map(function (l) { return '<a href="#/' + l[0] + '"' + (on === l[0] ? ' class="on"' : '') + '>' + l[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="who"><button class="btn sm" data-act="recargar">Actualizar</button><span class="chip">' + esc(S.user.email) + '</span><button class="btn sm" data-act="salir">Salir</button></div></header>' +
      (drive ? '<div style="padding-top:16px">' + drive + '</div>' : '') + otros + '<main>' + body + '</main>';
  }

  function renderLogin(msg) {
    app.innerHTML = '<div class="login"><div class="box">' +
      '<svg width="140" height="140" viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="58" fill="none" stroke="#343A50" stroke-width="3" stroke-dasharray="273 365" transform="rotate(135 70 70)"/><circle cx="70" cy="70" r="58" fill="none" stroke="#F2A93B" stroke-width="4" stroke-linecap="round" stroke-dasharray="190 365" transform="rotate(135 70 70)"/><circle cx="70" cy="70" r="7" fill="#E8604C"/></svg>' +
      '<h1 style="margin-top:20px;font-size:30px;letter-spacing:.18em">ENFOCO</h1><p class="cond mut" style="letter-spacing:.1em">CRM PRIVADO</p>' +
      '<button class="btn pri" style="margin-top:36px;width:100%;min-height:52px;font-size:16px" data-act="login">Entrar con Google</button>' +
      (msg ? '<p class="notice" style="margin-top:20px;text-align:left">' + esc(msg) + '</p>' : '') +
      '<p class="cond mut small" style="margin-top:20px">Solo puede entrar ' + esc(CFG.allowedEmails[0]) + '.</p></div></div>';
  }

  function render() {
    if (!S.user) return renderLogin();
    if (S.loading || !S.M) { app.innerHTML = shell('<div class="loading">Leyendo Firebase y las planillas…</div>', ''); return; }
    var h = (location.hash || '#/tablero').slice(2).split('/');
    var v = h[0] || 'tablero', body;
    if (v === 'campanas') body = vCampana(h[1] || 'vistage');
    else if (v === 'contactos') body = vContactos();
    else if (v === 'contacto') body = vFicha(decodeURIComponent(h[1] || ''));
    else if (v === 'presupuestos') body = vPresupuestos();
    else if (v === 'finanzas') body = vFinanzas();
    else { v = 'tablero'; body = vTablero(); }
    app.innerHTML = shell(body, v === 'contacto' ? 'contactos' : v);
  }

  function abiertos() { return S.M.presupuestos.filter(function (p) { return p.estadoNum === 1 || p.estadoNum === 2; }); }

  function tablaPresupuestos(rows) {
    if (!rows.length) return '<p class="mut">No hay presupuestos para mostrar.</p>';
    return '<div class="scroll"><table class="t" style="min-width:820px"><thead><tr><th>Empresa / trabajo</th><th style="text-align:right">Monto</th><th>Estado</th><th style="text-align:right">Días del envío</th><th>Seguimientos</th><th>Próxima acción</th></tr></thead><tbody>' +
      rows.map(function (p) {
        var c = S.M.contactos.filter(function (x) { return x.presupuestos.indexOf(p) >= 0; })[0];
        var nombre = c ? '<a href="#/contacto/' + encodeURIComponent(c.key) + '" style="color:inherit;text-decoration:none">' + esc(p.empresa) + '</a>' : esc(p.empresa);
        var monto = p.usd != null ? money(p.usd, 'USD') : money(p.ars, 'ARS');
        if (p.usd != null && p.ars != null) monto = money(p.ars, 'ARS') + '<br>' + money(p.usd, 'USD');
        return '<tr><td>· ' + nombre + '<div class="mut small" style="padding-left:10px;margin-top:3px">' + esc(p.trabajo) + (p.canal ? ' · ' + esc(p.canal) : '') + '</div></td>' +
          '<td class="num">' + monto + '</td><td>' + stateTag(p) + '</td>' +
          '<td class="num" style="color:' + (p.dias > 14 ? '#E8604C' : p.dias > 7 ? '#F2A93B' : '#E6E8EF') + '">' + (p.dias == null ? '—' : p.dias) + '</td>' +
          '<td style="white-space:nowrap">' + p.seguimientos + ' <button class="btn sm" data-seg="' + esc(p.id) + '" aria-label="Anotar un seguimiento a ' + esc(p.empresa) + '">+1</button></td>' +
          '<td style="white-space:nowrap;color:' + (p.vencido ? '#E8604C' : '#E6E8EF') + '">' + (p.vencido ? 'Vencido ' : '') + fdate(p.prox) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function vTablero() {
    var M = S.M, P = M.presupuestos;
    var env = P.filter(function (p) { return p.estadoNum === 2; }), porEnv = P.filter(function (p) { return p.estadoNum === 1; });
    var pausa = P.filter(function (p) { return p.estadoNum === 3; });
    var venc = P.filter(function (p) { return p.vencido; });
    var aprob = P.filter(function (p) { return p.estadoNum === 4; });
    var refArs = env.reduce(function (s, p) { return s + (p.ars || 0); }, 0), refUsd = env.reduce(function (s, p) { return s + (p.usd || 0); }, 0);
    var maxDias = Math.max.apply(null, [1].concat(env.concat(porEnv).map(function (p) { return p.dias || 0; })));
    var maxSeg = Math.max.apply(null, [3].concat(env.map(function (p) { return p.seguimientos; })));
    var hoy = D.startOfDay(M.hoy);

    var paraHoy = [];
    P.forEach(function (p) { if (p.estadoNum >= 1 && p.estadoNum <= 3 && p.prox && D.startOfDay(p.prox) <= hoy) paraHoy.push({ fecha: p.prox, quien: p.empresa, que: p.paso || p.trabajo, tipo: 'PRES', venc: p.vencido }); });
    M.contactos.forEach(function (c) { if (c.fuente === 'pipeline' && c.proxFecha && D.startOfDay(c.proxFecha) <= hoy && c.etapa !== 'Perdido') paraHoy.push({ fecha: c.proxFecha, quien: (c.nombre ? c.nombre + ' · ' : '') + c.empresa, que: c.proxPaso, tipo: 'LEAD', key: c.key, venc: D.startOfDay(c.proxFecha) < hoy }); });
    paraHoy.sort(function (a, b) { return a.fecha - b.fecha; });

    var resp = M.contactos.filter(function (c) { return c.fuente === 'prospeccion' && c.etapa === 'Respondió'; })
      .sort(function (a, b) { return (b.ultimo || 0) - (a.ultimo || 0); }).slice(0, 5);

    var c1 = M.campanas.filter(function (c) { return !c.historica; });
    var nombreH = (new Date().getHours() < 13 ? 'Buen día' : new Date().getHours() < 20 ? 'Buenas tardes' : 'Buenas noches');

    return '<section style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:24px"><div><p class="eyebrow">' + M.hoy.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</p><h1>' + nombreH + ', Dami.</h1></div>' +
      '<p class="soft" style="margin:0;max-width:440px;line-height:1.5">' + env.length + ' presupuestos enviados en juego' + (venc.length ? ', <span style="color:#E8604C">' + venc.length + ' con la próxima acción vencida</span>' : '') + ' y ' + paraHoy.length + ' cosas para hoy.</p></section>' +

      '<section class="hero" aria-label="Presupuestos en juego"><div class="gauge">' +
      '<svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="' + env.length + ' presupuestos enviados en juego"><circle cx="100" cy="100" r="82" fill="none" stroke="#343A50" stroke-width="4" stroke-dasharray="386 515" transform="rotate(135 100 100)"/>' +
      '<circle cx="100" cy="100" r="82" fill="none" stroke="#F2A93B" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + Math.round(386 * Math.min(1, env.length / Math.max(env.length + porEnv.length + 3, 7))) + ' 515" transform="rotate(135 100 100)"/>' +
      '<text x="100" y="108" text-anchor="middle" fill="#E6E8EF" font-family="Barlow" font-weight="300" font-size="64">' + env.length + '</text><text x="100" y="136" text-anchor="middle" fill="#8A90A6" font-family="Barlow Semi Condensed" font-size="14" letter-spacing="2">ENVIADOS</text></svg>' +
      '<p style="margin:6px 0 0;font-size:16px">Presupuestos en juego</p><p class="cond mut small" style="margin:4px 0 0">' + porEnv.length + ' por enviar · ' + pausa.length + ' en pausa</p>' +
      '<p class="cond small" style="margin:2px 0 0;color:#7D8299">Referencia interna: ARS ' + millones(refArs) + (refUsd ? ' · USD ' + miles(refUsd) : '') + '</p></div>' +
      '<div class="grow bars"><div class="sechead src"><span>Enviados y por enviar</span><span><span style="display:inline-block;width:10px;height:10px;background:#F2A93B;margin-right:6px"></span>Días del envío &nbsp; <span style="display:inline-block;width:10px;height:10px;background:#8C90CF;margin-right:6px"></span>Seguimientos</span></div>' +
      env.concat(porEnv).map(function (p) {
        return '<div class="b"><div class="t"><span>· ' + esc(p.empresa) + '</span><span>' + stateTag(p) + ' <span style="color:#F2A93B">' + (p.dias == null ? 'sin enviar' : p.dias + ' días') + '</span><span style="color:#5C6380"> / </span>' + p.seguimientos + ' seg.</span></div>' +
          '<div class="track"><div style="width:' + (p.dias == null ? 0 : Math.max(2, p.dias * 100 / maxDias)) + '%;background:#F2A93B"></div></div>' +
          '<div class="track" style="margin-top:5px"><div style="width:' + (p.seguimientos * 100 / maxSeg) + '%;background:#8C90CF"></div></div></div>';
      }).join('') + '</div></section>' +

      '<section class="rings" aria-label="Estado de presupuestos">' +
      [[porEnv.length, 'Por enviar', 'falta mandarlos', '#4FB8A8'], [venc.length, 'Vencidos', 'próxima acción pasada', '#E8604C'], [pausa.length, 'En pausa', 'para retomar con fecha', '#8C90CF'], [aprob.length, 'Aprobados', 'en el año', '#E6E8EF']]
        .map(function (x) { return '<div class="ring">' + ring(x[0], Math.max(P.length / 3, x[0]), x[3]) + '<p>' + x[1] + '</p><p class="cond mut small" style="margin-top:2px">' + x[2] + '</p></div>'; }).join('') + '</section>' +

      '<div class="row"><section class="grow" aria-labelledby="t-pres"><div class="sechead"><h2 id="t-pres">Presupuestos abiertos</h2><span class="src">en vivo · planilla Presupuesto 2026</span></div>' +
      tablaPresupuestos(env.concat(porEnv)) + '<p class="src" style="margin-top:12px">El +1 anota un seguimiento hecho. La planilla sigue mandando: acá se lee, se carga allá. <a href="#/presupuestos">Ver todos</a></p></section>' +
      '<aside class="side"><section aria-labelledby="t-hoy"><h2 id="t-hoy" style="margin-bottom:14px">Para hoy</h2>' +
      (paraHoy.length ? '<ol class="list">' + paraHoy.slice(0, 8).map(function (x) {
        var inner = '<div class="cond small" style="display:flex;justify-content:space-between;color:' + (x.venc ? '#E8604C' : '#F2A93B') + '"><span>' + x.tipo + '</span><span>' + (x.venc ? 'vencido ' : '') + fdate(x.fecha) + '</span></div><div style="margin-top:6px">' + esc(x.quien) + '</div><div class="mut small" style="margin-top:4px;line-height:1.45">' + esc((x.que || '').slice(0, 160)) + '</div>';
        return '<li>' + (x.key ? '<a class="card" style="border-left-color:' + (x.venc ? '#E8604C' : '#F2A93B') + '" href="#/contacto/' + encodeURIComponent(x.key) + '">' + inner + '</a>' : '<div class="card" style="border-left-color:' + (x.venc ? '#E8604C' : '#F2A93B') + '">' + inner + '</div>') + '</li>';
      }).join('') + '</ol>' + (paraHoy.length > 8 ? '<p class="src">y ' + (paraHoy.length - 8) + ' más</p>' : '') : '<p class="mut">Nada pendiente para hoy.</p>') + '</section>' +
      '<section aria-labelledby="t-resp"><h2 id="t-resp" style="margin-bottom:14px">Respondieron</h2>' +
      (resp.length ? '<ul class="list">' + resp.map(function (c) {
        var camp = M.campanas.filter(function (k) { return k.id === c.campana; })[0];
        return '<li><a class="card" style="border-left-color:' + (camp ? camp.color : '#F2A93B') + '" href="#/contacto/' + encodeURIComponent(c.key) + '"><div class="cond small mut" style="display:flex;justify-content:space-between"><span>' + esc(camp ? camp.nombre : '') + '</span><span>' + fdate(c.ultimo) + '</span></div><div style="margin-top:6px;font-size:17px">' + esc(c.nombre) + '</div><div class="mut">' + esc(c.empresa) + '</div></a></li>';
      }).join('') + '</ul>' : '<p class="mut">Sin respuestas nuevas.</p>') + '</section></aside></div>' +

      '<section aria-labelledby="t-camp"><div class="sechead"><h2 id="t-camp">Campañas</h2><a href="#/campanas" class="small">Ver detalle</a></div><div class="camps">' +
      c1.map(cardCampana).join('') + '</div></section>' +
      (S.fin ? bloqueFinanzas(true) : '');
  }

  function cardCampana(k) {
    var cells = k.id === 'exclientes'
      ? [[k.total, 'En la lista'], [k.enviados, 'Contactados'], [k.ganados, 'Aprobados'], ['—', '']]
      : [[k.enviados, 'Enviados'], [k.respondieron, 'Respondieron'], [k.reuniones, 'Reuniones'], [k.presupuestos, 'Presupuestos']];
    var base = k.id === 'exclientes' ? k.total : k.enviados;
    var r2 = k.id === 'exclientes' ? k.enviados : k.respondieron;
    return '<a class="card" style="border-left-color:' + k.color + ';padding:20px" href="#/campanas/' + k.id + '"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><span style="font-size:18px">' + esc(k.nombre) + '</span>' +
      '<span class="cond small mut">' + (k.id === 'exclientes' ? '' : 'respuesta ' + pct(k.respondieron, k.enviados)) + '</span></div><div class="kgrid">' +
      cells.map(function (c, i) { return '<div><div class="n" style="color:' + (i === 1 ? '#F2A93B' : i === 0 ? '#8C90CF' : '#E6E8EF') + '">' + (c[0] == null ? '—' : c[0]) + '</div><div class="l">' + c[1] + '</div></div>'; }).join('') + '</div>' +
      '<div class="track" style="margin-top:14px"><div style="width:100%;background:#8C90CF"></div></div><div class="track" style="margin-top:5px"><div style="width:' + (base ? r2 * 100 / base : 0) + '%;background:#F2A93B"></div></div></a>';
  }

  function vCampana(id) {
    var M = S.M, k = M.campanas.filter(function (c) { return c.id === id; })[0] || M.campanas[0];
    var tabs = '<div class="tabs" role="tablist">' + M.campanas.map(function (c) { return '<a class="tab' + (c.id === k.id ? ' on' : '') + '" role="tab" aria-selected="' + (c.id === k.id) + '" href="#/campanas/' + c.id + '">' + esc(c.nombre) + '</a>'; }).join('') + '</div>';
    var head = '<section style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:24px"><div style="max-width:720px"><p class="eyebrow" style="color:' + k.color + '">' + (k.historica ? 'Cerrada' : 'Activa') + (k.ultimoEnvio ? ' · último envío ' + fdate(k.ultimoEnvio) : '') + '</p><h1>' + esc(k.nombre) + '</h1><p class="soft" style="line-height:1.55">' + esc(k.desc) + '</p></div>' +
      '<dl class="kv" style="align-content:start"><dt>Canales</dt><dd>' + esc(k.canales) + '</dd><dt>Firma</dt><dd>' + esc(k.firma) + '</dd></dl></section>';
    if (k.id === 'exclientes') return tabs + head + vExClientes(k);

    var steps = [['Enviados', k.enviados, ''], ['Respondieron', k.respondieron, pct(k.respondieron, k.enviados)], ['Reunión', k.reuniones, pct(k.reuniones, k.respondieron)], ['Presupuesto', k.presupuestos, pct(k.presupuestos, k.respondieron)], ['Ganado', k.ganados, pct(k.ganados, k.presupuestos)]];
    var max = Math.max(1, k.enviados);
    var funnel = '<section aria-labelledby="t-emb"><div class="sechead"><h2 id="t-emb">Embudo</h2><span class="src">' + k.rebotados + ' rebotados · ' + k.muertos + ' sin respuesta tras el seguimiento</span></div><div class="funnel">' +
      steps.map(function (s, i) { return '<div class="f"><span class="soft">' + s[0] + '</span><div class="bar"><div style="width:' + Math.max(s[1] ? 1 : 0, s[1] * 100 / max) + '%;background:' + k.color + ';opacity:' + (1 - i * 0.13) + '"></div></div><span class="cond" style="text-align:right">' + s[1] + (s[2] ? ' · ' + s[2] : '') + '</span></div>'; }).join('') +
      '</div><p class="src" style="margin-top:12px">El porcentaje es el paso de una etapa a la siguiente, para ver dónde se traba.</p></section>';
    var maxS = Math.max.apply(null, [1].concat(k.semanas.map(function (s) { return s.n; })));
    var semanas = '<section style="flex:1 1 380px;min-width:0"><h2 style="margin-bottom:18px">Envíos por semana</h2><div style="display:flex;align-items:flex-end;gap:10px;height:140px">' +
      k.semanas.map(function (s) { return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><span class="cond small">' + (s.n || '') + '</span><div style="width:100%;max-width:26px;height:' + (s.n * 110 / maxS) + 'px;background:#8C90CF"></div><span class="cond small mut" style="margin-top:6px">' + fdate(s.ini) + '</span></div>'; }).join('') + '</div></section>';
    var rubros = '<section style="flex:1 1 380px;min-width:0"><h2 style="margin-bottom:12px">Quién responde, por rubro</h2>' + (k.rubros.length ? k.rubros.map(function (r) { return '<div style="display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #2C3246"><span>' + esc(r.rubro) + '</span><span class="cond"><span style="color:#F2A93B">' + pct(r.resp, r.n) + '</span> <span class="mut">de ' + r.n + '</span></span></div>'; }).join('') : '<p class="mut">Todavía no hay rubros cargados en esta campaña.</p>') + '</section>';
    var lista = k.contactos.slice().sort(function (a, b) { var o = { 'Ganado': 0, 'Presupuesto': 1, 'Reunión': 2, 'Respondió': 3, 'En pausa': 4 }; return (o[a.etapa] == null ? 9 : o[a.etapa]) - (o[b.etapa] == null ? 9 : o[b.etapa]) || (b.ultimo || 0) - (a.ultimo || 0); });
    return tabs + head + funnel + '<div class="row">' + semanas + rubros + '</div>' +
      '<section><div class="sechead"><h2>Contactos de la campaña</h2><a class="small" href="#/contactos" data-camp="' + k.id + '">Ver en Contactos con filtros</a></div>' + tablaContactos(lista.slice(0, 60)) +
      (lista.length > 60 ? '<p class="src">Mostrando 60 de ' + lista.length + '. El resto, en Contactos.</p>' : '') + '</section>';
  }

  function vExClientes(k) {
    var est = Object.keys(k.porEstado).sort();
    return '<section><div class="sechead"><h2>Estado de la lista</h2><span class="src">en vivo · planilla POSIBLES PROYECTOS</span></div><div class="rings">' +
      est.map(function (e) { return '<div class="ring">' + ring(k.porEstado[e], k.total, '#8C90CF') + '<p>' + esc(e.replace(/^\d+\s*-\s*/, '')) + '</p></div>'; }).join('') + '</div></section>' +
      '<section><h2 style="margin-bottom:16px">Lista</h2><div class="scroll"><table class="t" style="min-width:760px"><thead><tr><th>Empresa</th><th>Qué se le propone</th><th>Estado</th><th>Envío</th><th>Canal</th><th>Quién</th></tr></thead><tbody>' +
      k.filas.map(function (p) { return '<tr><td>· ' + esc(p.empresa) + '</td><td class="soft small">' + esc(p.propuesta.slice(0, 120)) + '</td><td>' + esc(p.estado.replace(/^\d+\s*-\s*/, '')) + '</td><td>' + fdate(p.envio) + '</td><td>' + esc(p.canal) + '</td><td>' + esc(p.responsable) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>';
  }

  function tablaContactos(rows) {
    if (!rows.length) return '<p class="mut">No hay contactos con ese filtro.</p>';
    return '<div class="scroll"><table class="t" style="min-width:860px"><thead><tr><th>Contacto</th><th>Rubro</th><th>Campaña</th><th>Etapa</th><th>Último movimiento</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var camp = S.M.campanas.filter(function (k) { return k.id === c.campana; })[0];
        return '<tr><td><a href="#/contacto/' + encodeURIComponent(c.key) + '" style="color:#E6E8EF;text-decoration:none">' + esc(c.nombre || '(sin nombre)') + '</a><div class="mut small" style="margin-top:3px">' + esc(c.empresa) + (c.cargo ? ' · ' + esc(c.cargo) : '') + '</div></td>' +
          '<td class="soft small">' + esc(c.rubro) + '</td><td class="small" style="color:' + (camp ? camp.color : '#8A90A6') + '">' + esc(camp ? camp.nombre : c.fuente === 'pipeline' ? 'Pipeline' : '') + '</td><td>' + etapaTag(c.etapa) + '</td><td class="mut">' + fdate(c.ultimo) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function vContactos() {
    var f = S.filtro, M = S.M;
    var q = D.norm(f.q);
    var rows = M.contactos.filter(function (c) {
      if (f.etapa && c.etapa !== f.etapa) return false;
      if (f.camp && c.campana !== f.camp) return false;
      if (q && D.norm(c.nombre + ' ' + c.empresa + ' ' + c.rubro + ' ' + c.cargo).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.ultimo || 0) - (a.ultimo || 0); });
    var etapas = ['Contactado', 'Sin respuesta', 'Rebotado', 'Respondió', 'Reunión', 'Presupuesto', 'En pausa', 'Ganado', 'Perdido'];
    var cuenta = {}; M.contactos.forEach(function (c) { cuenta[c.etapa] = (cuenta[c.etapa] || 0) + 1; });
    return '<section><p class="eyebrow">Base completa</p><h1>' + M.contactos.length + ' contactos</h1><p class="soft">Pipeline y prospección juntos, una ficha por persona.</p></section>' +
      '<section><div class="filters" style="margin-bottom:18px"><label class="cond small mut" for="fq" style="position:absolute;left:-9999px">Buscar</label><input id="fq" class="in" placeholder="Buscar nombre, empresa, rubro o cargo" value="' + esc(f.q) + '">' +
      '<select class="in" id="fe" aria-label="Etapa"><option value="">Todas las etapas</option>' + etapas.map(function (e) { return '<option' + (f.etapa === e ? ' selected' : '') + ' value="' + e + '">' + e + ' (' + (cuenta[e] || 0) + ')</option>'; }).join('') + '</select>' +
      '<select class="in" id="fc" aria-label="Campaña"><option value="">Todas las campañas</option><option value="pipeline"' + (f.camp === 'pipeline' ? ' selected' : '') + '>Pipeline</option>' + M.campanas.filter(function (k) { return k.id !== 'exclientes'; }).map(function (k) { return '<option value="' + k.id + '"' + (f.camp === k.id ? ' selected' : '') + '>' + esc(k.nombre) + '</option>'; }).join('') + '</select>' +
      '<button class="btn" data-act="exportar">Exportar lista (' + rows.length + ')</button></div>' +
      tablaContactos(rows.slice(0, 200)) + (rows.length > 200 ? '<p class="src">Mostrando 200 de ' + rows.length + '. Afiná con los filtros o exportá la lista.</p>' : '') + '</section>';
  }

  function vFicha(key) {
    var c = S.M.porKey[key];
    if (!c) return '<p class="mut">No encontré ese contacto. <a href="#/contactos">Volver a contactos</a></p>';
    var orden = ['Contactado', 'Respondió', 'Reunión', 'Presupuesto', 'En pausa', 'Ganado'];
    var idx = orden.indexOf(c.etapa); if (c.etapa === 'Sin respuesta' || c.etapa === 'Rebotado') idx = 0;
    var wpp = String(c.wpp || '').replace(/\D/g, '');
    var campNom = c.campanas.map(function (r) { var k = S.M.campanas.filter(function (x) { return x.id === r.campana; })[0]; return (k ? k.nombre : r.campana) + (r.fechaEnvio ? ' (' + fdate(r.fechaEnvio) + ')' : ''); }).join(', ');
    var analisis = [c.resumen].concat(c.campanas.map(function (r) { return r.gancho || r.resumen; })).filter(Boolean);
    return '<a href="#/contactos" class="small" style="text-decoration:none">← Contactos</a>' +
      '<section style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px"><div><p class="eyebrow">' + esc(c.empresa) + '</p><h1>' + esc(c.nombre || c.empresa) + '</h1>' + (c.cargo ? '<p class="soft" style="margin:10px 0 0">' + esc(c.cargo) + '</p>' : '') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' + (wpp ? '<a class="btn pri" style="display:inline-flex;align-items:center;text-decoration:none" href="https://wa.me/' + wpp + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
      (c.mail ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none;color:#E6E8EF" href="mailto:' + esc(c.mail) + '">Mail</a>' : '') +
      (c.linkedin ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none;color:#E6E8EF" href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') + '</div></section>' +
      '<section aria-label="Etapa"><ol class="stages">' + orden.map(function (e, i) { var col = i < idx ? '#E6E8EF' : i === idx ? '#F2A93B' : '#343A50'; return '<li><div class="s" style="background:' + col + '"></div><div class="small" style="margin-top:8px;color:' + (i === idx ? '#F2A93B' : i < idx ? '#E6E8EF' : '#7D8299') + '">' + e + '</div></li>'; }).join('') + '</ol>' +
      (['Perdido', 'Sin respuesta', 'Rebotado'].indexOf(c.etapa) >= 0 ? '<p class="small" style="color:#E8604C;margin-top:10px">' + esc(c.etapa) + '</p>' : '') + '</section>' +
      '<div class="row"><div class="grow" style="display:flex;flex-direction:column;gap:40px">' +
      (c.proxFecha || c.proxPaso ? '<section class="card" style="border-left-color:' + (c.proxFecha && D.startOfDay(c.proxFecha) < D.startOfDay(S.M.hoy) ? '#E8604C' : '#F2A93B') + ';padding:20px"><div class="cond small mut">PRÓXIMA ACCIÓN · ' + fdate(c.proxFecha) + '</div><p style="margin:10px 0 0;font-size:17px;line-height:1.5">' + esc(c.proxPaso || '—') + '</p></section>' : '') +
      '<section><h2 style="margin-bottom:18px">Historial</h2>' + (c.historial.length ? '<ol class="timeline">' + c.historial.slice(0, 40).map(function (h) { return '<li><div class="cond small mut">' + fdate(h.fecha) + (h.quien ? ' · ' + esc(h.quien) : '') + (h.tipo ? ' · <span style="color:#F2A93B">' + esc(h.tipo) + '</span>' : '') + '</div><p class="txt">' + esc(h.texto) + '</p></li>'; }).join('') + '</ol>' : '<p class="mut">Sin historial cargado.</p>') + '</section></div>' +
      '<aside class="side">' +
      (c.presupuestos.length ? '<section><h2 style="margin-bottom:14px">Presupuestos</h2>' + c.presupuestos.map(function (p) { return '<div style="padding:12px 0;border-bottom:1px solid #2C3246"><div style="display:flex;justify-content:space-between;gap:10px"><span>' + esc(p.trabajo || p.empresa) + '</span>' + stateTag(p) + '</div><div style="margin-top:6px;font-size:22px;font-weight:300">' + (p.usd != null ? money(p.usd, 'USD') : money(p.ars, 'ARS')) + '</div><div class="cond small mut">' + (p.envio ? 'Enviado ' + fdate(p.envio) + ' · ' + p.dias + ' días' : 'Sin enviar') + ' · ' + p.seguimientos + ' seguimientos</div></div>'; }).join('') + '</section>' : '') +
      '<section><h2 style="margin-bottom:14px">Datos</h2><dl class="kv">' +
      [['Mail', c.mail], ['WhatsApp', c.wpp], ['Rubro', c.rubro], ['Cómo llegó', [c.origen, c.medio].filter(Boolean).join(' · ')], ['Campaña', campNom], ['Etapa', c.etapa], ['Creado', fdate(c.creado)]]
        .filter(function (x) { return x[1]; }).map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl></section>' +
      (analisis.length ? '<section><h2 style="margin-bottom:12px">Lo que sabemos</h2>' + analisis.map(function (a) { return '<p class="soft" style="margin:0 0 10px;line-height:1.55">' + esc(a) + '</p>'; }).join('') + '</section>' : '') +
      '</aside></div>';
  }

  function vPresupuestos() {
    var P = S.M.presupuestos;
    var grupos = [[1, 'Por enviar'], [2, 'Enviados'], [3, 'En pausa y sin respuesta'], [4, 'Aprobados'], [5, 'Rechazados']];
    var tot = function (arr, k) { return arr.reduce(function (s, p) { return s + (p[k] || 0); }, 0); };
    var aprob = P.filter(function (p) { return p.estadoNum === 4; }), rech = P.filter(function (p) { return p.estadoNum === 5; });
    return '<section><p class="eyebrow">Planilla Presupuesto 2026 · en vivo</p><h1>' + P.length + ' presupuestos en el año</h1></section>' +
      '<section class="rings">' + grupos.map(function (g) { var n = P.filter(function (p) { return p.estadoNum === g[0]; }).length; return '<div class="ring">' + ring(n, P.length, D.ESTADOS[g[0]].color) + '<p>' + g[1] + '</p></div>'; }).join('') +
      '<div class="ring"><div style="font-size:44px;font-weight:300;margin-top:24px">' + pct(aprob.length, aprob.length + rech.length) + '</div><p>Tasa de cierre</p><p class="cond mut small">aprobados sobre resueltos</p></div></section>' +
      '<section class="row" style="gap:24px 56px"><div><p class="src">| Aprobado en el año</p><p style="margin:6px 0 0;font-size:28px;font-weight:300">ARS ' + millones(tot(aprob, 'ars')) + ' <span class="small mut">· USD ' + miles(tot(aprob, 'usd')) + '</span></p></div>' +
      '<div><p class="src">| Ticket promedio aprobado</p><p style="margin:6px 0 0;font-size:28px;font-weight:300">ARS ' + (aprob.filter(function (p) { return p.ars; }).length ? millones(tot(aprob, 'ars') / aprob.filter(function (p) { return p.ars; }).length) : '—') + '</p></div></section>' +
      grupos.map(function (g) {
        var rows = P.filter(function (p) { return p.estadoNum === g[0]; });
        if (!rows.length) return '';
        if (g[0] >= 3) rows.sort(function (a, b) { return (b.envio || 0) - (a.envio || 0); });
        return '<section><div class="sechead"><h2>' + g[1] + ' (' + rows.length + ')</h2></div>' + tablaPresupuestos(rows) + '</section>';
      }).join('');
  }

  function bloqueFinanzas(corto) {
    var F = S.fin; if (!F || !F.meses.length) return '';
    var actuales = F.meses.filter(function (m) { return m.ars.ing || m.ars.egr || m.usd.ing; });
    var max = Math.max.apply(null, [1].concat(actuales.map(function (m) { return m.ars.ing; })));
    var W = 640, H = 200, n = actuales.length, x = function (i) { return 40 + i * (W - 60) / Math.max(1, n - 1); }, y = function (v) { return 170 - v * 150 / max; };
    var pts = actuales.map(function (m, i) { return x(i).toFixed(0) + ',' + y(m.ars.ing).toFixed(0); }).join(' ');
    var ptsE = actuales.map(function (m, i) { return x(i).toFixed(0) + ',' + y(m.ars.egr).toFixed(0); }).join(' ');
    var chart = '<svg viewBox="0 0 ' + W + ' 215" width="100%" role="img" aria-label="Ingresos y egresos en pesos por mes"><g stroke="#343A50">' + [20, 70, 120, 170].map(function (v) { return '<line x1="40" y1="' + v + '" x2="' + (W - 20) + '" y2="' + v + '"/>'; }).join('') + '</g>' +
      '<polygon points="40,170 ' + pts + ' ' + x(n - 1).toFixed(0) + ',170" fill="#F2A93B" fill-opacity="0.12"/><polyline points="' + pts + '" fill="none" stroke="#F2A93B" stroke-width="2"/><polyline points="' + ptsE + '" fill="none" stroke="#8C90CF" stroke-width="1.5" stroke-dasharray="4 4"/>' +
      '<g fill="#8A90A6" font-family="Barlow Semi Condensed" font-size="12" text-anchor="middle">' + actuales.map(function (m, i) { return '<text x="' + x(i).toFixed(0) + '" y="196">' + esc(m.mes.slice(0, 3)) + '</text>'; }).join('') + '</g>' +
      '<g fill="#8A90A6" font-family="Barlow Semi Condensed" font-size="11">' + '<text x="0" y="24">' + millones(max) + '</text></g></svg>';
    var ult = actuales[actuales.length - 1];
    return '<section id="finanzas" aria-labelledby="t-fin" class="row" style="gap:40px"><div style="flex:1 1 260px;display:flex;flex-direction:column;gap:24px;border-right:1px solid #343A50;padding-right:32px">' +
      '<h2 id="t-fin">Finanzas ' + (corto ? '' : '2026') + '</h2>' +
      '<div><p class="src">| Ingresos del año</p><p style="margin:6px 0 0;font-size:30px;font-weight:300">ARS ' + millones(F.totalArs) + '</p><p class="cond mut" style="margin:2px 0 0">USD ' + miles(F.totalUsd) + '</p></div>' +
      '<div><p class="src">| Resultado del año</p><p style="margin:6px 0 0;font-size:30px;font-weight:300;color:#F2A93B">ARS ' + millones(F.resultadoArs) + '</p><p class="cond mut" style="margin:2px 0 0">USD ' + miles(F.resultadoUsd) + '</p></div>' +
      (ult ? '<div><p class="src">| ' + esc(ult.mes) + '</p><p style="margin:6px 0 0;font-size:22px;font-weight:300">ARS ' + millones(ult.ars.ing) + ' <span class="small mut">ingresos</span></p></div>' : '') + '</div>' +
      '<div style="flex:999 1 520px;min-width:0"><div class="src" style="display:flex;gap:18px;margin-bottom:10px"><span><span style="display:inline-block;width:14px;height:2px;background:#F2A93B;vertical-align:middle;margin-right:6px"></span>Ingresos ARS</span><span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #8C90CF;vertical-align:middle;margin-right:6px"></span>Egresos ARS</span></div>' + chart +
      '<p class="src">en vivo · Ganancias y pérdidas 2026, pestaña Mensual. Pesos y dólares por separado.' + (corto ? ' <a href="#/finanzas">Ver finanzas</a>' : '') + '</p></div></section>';
  }

  function vFinanzas() {
    var F = S.fin;
    if (!F) return '<p class="mut">No se pudo leer la planilla de Ganancias y pérdidas.</p>';
    var maxS = Math.max.apply(null, [1].concat(F.servicios.map(function (s) { return s.ars; })));
    var totS = F.servicios.reduce(function (s, x) { return s + x.ars; }, 0);
    return bloqueFinanzas(false) +
      '<section><div class="sechead"><h2>Mes a mes</h2></div><div class="scroll"><table class="t" style="min-width:760px"><thead><tr><th>Mes</th><th style="text-align:right">Ingresos ARS</th><th style="text-align:right">Egresos ARS</th><th style="text-align:right">Resultado ARS</th><th style="text-align:right">Ingresos USD</th><th style="text-align:right">Resultado USD</th></tr></thead><tbody>' +
      F.meses.filter(function (m) { return m.ars.ing || m.ars.egr || m.usd.ing || m.usd.egr; }).map(function (m) { return '<tr><td>' + esc(m.mes) + '</td><td class="num">' + miles(m.ars.ing) + '</td><td class="num">' + miles(m.ars.egr) + '</td><td class="num" style="color:' + (m.ars.res < 0 ? '#E8604C' : '#F2A93B') + '">' + miles(m.ars.res) + '</td><td class="num">' + miles(m.usd.ing) + '</td><td class="num" style="color:' + (m.usd.res < 0 ? '#E8604C' : '#E6E8EF') + '">' + miles(m.usd.res) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section>' +
      '<section><div class="sechead"><h2>Ingresos por servicio</h2><span class="src">pestaña Facturación · solo filas con servicio cargado</span></div>' +
      F.servicios.map(function (s) { return '<div class="bars"><div class="b"><div class="t"><span>· ' + esc(s.servicio) + '</span><span><span style="color:#F2A93B">ARS ' + millones(s.ars) + '</span><span class="mut"> · ' + pct(s.ars, totS) + (s.usd ? ' · USD ' + miles(s.usd) : '') + ' · ' + s.n + ' cobros</span></span></div><div class="track"><div style="width:' + (s.ars * 100 / maxS) + '%;background:#F2A93B"></div></div></div></div>'; }).join('') + '</section>' +
      '<p class="src">Cobrado contra facturado y días de cobro necesitan que la planilla tenga la fecha de factura y la de cobro. Hoy esa columna está vacía.</p>';
  }

  function exportar() {
    var f = S.filtro, q = D.norm(f.q);
    var rows = S.M.contactos.filter(function (c) { return (!f.etapa || c.etapa === f.etapa) && (!f.camp || c.campana === f.camp) && (!q || D.norm(c.nombre + ' ' + c.empresa + ' ' + c.rubro + ' ' + c.cargo).indexOf(q) >= 0); });
    var data = rows.map(function (c) { return { Nombre: c.nombre, Empresa: c.empresa, Cargo: c.cargo, Mail: c.mail, WhatsApp: c.wpp, LinkedIn: c.linkedin, Rubro: c.rubro, Campaña: c.campana, Etapa: c.etapa, 'Último movimiento': c.ultimo ? c.ultimo.toISOString().slice(0, 10) : '' }; });
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Contactos');
    XLSX.writeFile(wb, 'Enfoco contactos ' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  // ---------- eventos ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-seg],[data-camp]');
    if (!t) return;
    if (t.dataset.seg) { sumarSeguimiento(t.dataset.seg); return; }
    if (t.dataset.camp) { S.filtro = { q: '', etapa: '', camp: t.dataset.camp }; return; }
    var a = t.dataset.act;
    if (a === 'login') login();
    else if (a === 'salir') window._enfoco.salir();
    else if (a === 'reconectar') reconectarDrive();
    else if (a === 'recargar') cargar();
    else if (a === 'exportar') exportar();
  });
  var deb;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'fq') { S.filtro.q = e.target.value; clearTimeout(deb); deb = setTimeout(function () { var pos = e.target.selectionStart; render(); var i = document.getElementById('fq'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 250); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'fe') { S.filtro.etapa = e.target.value; render(); }
    if (e.target.id === 'fc') { S.filtro.camp = e.target.value; render(); }
  });
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
})();
