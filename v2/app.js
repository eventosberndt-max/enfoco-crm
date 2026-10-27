(function () {
  'use strict';
  var CFG = window.ENFOCO_CONFIG, D = window.EnfocoData;
  var app = document.getElementById('app');
  var S = { user: null, token: null, raw: {}, M: null, fin: null, blue: null, blueHoy: null, docs: [], errors: [], loading: false,
    filtro: { q: '', etapa: '', camp: '' }, presTab: 'enviado', qPres: '' };
  var TOKEN_KEY = 'enfoco_drive_token';
  var OBJ = CFG.objetivoSocioUsd || 2000;

  // ---------- utilidades ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function miles(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function money(n, cur) { return n == null ? '—' : '<span class="cur">' + cur + '</span>' + miles(n); }
  function millones(n) { return (n / 1e6).toFixed(Math.abs(n) >= 1e8 ? 0 : 1).replace('.', ',') + ' M'; }
  function usd(n) { return n == null ? '—' : 'USD ' + miles(n); }
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
  function gmailLink(q) { return 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent(CFG.allowedEmails[0]) + '#search/' + encodeURIComponent(q); }
  function campDe(id) { return S.M.campanas.filter(function (k) { return k.id === id; })[0]; }

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
  function salir() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} auth.signOut(); }

  auth.onAuthStateChanged(function (u) {
    if (!u) { S.user = null; renderLogin(); return; }
    if (!permitido(u)) { auth.signOut(); renderLogin('Esa cuenta no tiene acceso.'); return; }
    S.user = u; S.token = S.token || tokenGuardado();
    cargar();
  });

  // ---------- carga ----------
  function drive(url) {
    return fetch(url, { headers: { Authorization: 'Bearer ' + S.token } }).then(function (r) {
      if (r.status === 401) throw Object.assign(new Error('La conexión con Drive venció'), { drive401: true });
      if (!r.ok) throw new Error('Drive respondió ' + r.status);
      return r;
    });
  }
  function driveXlsx(id, nativo) {
    var url = nativo ? 'https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=' + encodeURIComponent('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      : 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media';
    return drive(url)
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (buf) { return XLSX.read(buf, { type: 'array', cellDates: true }); });
  }
  function driveList(q) {
    return drive('https://www.googleapis.com/drive/v3/files?pageSize=1000&fields=files(id,name,mimeType,webViewLink,modifiedTime)&q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); }).then(function (j) { return j.files || []; });
  }
  function docsPresupuestos() {
    var ids = [CFG.carpetas && CFG.carpetas.presupuestos2026].filter(Boolean);
    return driveList("name = 'Presupuestos 2025' and mimeType = 'application/vnd.google-apps.folder' and trashed = false")
      .then(function (f) { f.forEach(function (x) { ids.push(x.id); }); })
      .catch(function () {})
      .then(function () { return Promise.all(ids.map(function (id) { return driveList("'" + id + "' in parents and trashed = false").catch(function () { return []; }); })); })
      .then(function (ls) { return [].concat.apply([], ls); });
  }
  function leer(path) { return db.ref(path).once('value').then(function (s) { return s.val() || {}; }); }
  function cargarBlue() {
    return fetch('https://api.bluelytics.com.ar/v2/evolution.json').then(function (r) { return r.json(); })
      .then(function (j) { S.blue = D.blueMensual(j); var hoy = j.filter(function (x) { return x.source === 'Blue'; })[0]; S.blueHoy = hoy ? +hoy.value_sell : null; })
      .catch(function () { S.blue = null; });
  }

  function cargar() {
    S.loading = true; S.errors = []; render();
    var hoy = new Date();
    var pFire = Promise.all([leer('leads'), leer('outreach'), leer('crm/seguimientos').catch(function () { return {}; })])
      .then(function (r) { S.raw.leads = r[0]; S.raw.outreach = r[1]; S.raw.seg = r[2]; try { espejarHistorial(); } catch (e) {} })
      .catch(function (e) { S.errors.push('Firebase: ' + e.message); });
    var pBlue = cargarBlue();
    var pCrm = !S.token ? Promise.resolve(S.errors.push('drive')) : driveXlsx(CFG.sheets.crm, CFG.sheets.crmNativo).then(function (wb) {
      S.raw.presupuestos = D.parsePresupuestos(wb, hoy, 'Presupuesto 2026', 0);
      S.raw.pres25 = D.parsePresupuestos(wb, hoy, 'Presupuestos 2025', 2025);
      S.raw.posibles = D.parsePosibles(wb);
    }).catch(function (e) { S.errors.push(e.drive401 ? 'drive' : 'Planilla de presupuestos: ' + e.message); });
    var pDocs = !S.token ? Promise.resolve() : docsPresupuestos().then(function (f) { S.docs = f; }).catch(function () { S.docs = []; });
    var pFin = !S.token ? Promise.resolve() : Promise.all([driveXlsx(CFG.sheets.finanzas), pBlue]).then(function (r) { S.finWb = r[0]; })
      .catch(function (e) { S.errors.push(e.drive401 ? 'drive' : 'Ganancias y pérdidas: ' + e.message); });
    Promise.all([pFire, pCrm, pFin, pDocs, pBlue]).then(function () {
      var todos = (S.raw.presupuestos || []).concat(S.raw.pres25 || []);
      D.matchDocs(todos, S.docs);
      if (S.finWb) S.fin = D.parseFinanzas(S.finWb, S.blue || {}, hoy.getFullYear());
      S.M = D.buildModel({ hoy: hoy, leads: S.raw.leads, outreach: S.raw.outreach, presupuestos: todos, posibles: S.raw.posibles || [], seguimientos: S.raw.seg || {} });
      S.M.pres26 = S.M.presupuestos.filter(function (p) { return p.anio === 2026; });
      S.loading = false; render();
    });
  }

  function sumarSeguimiento(id) {
    var p = S.M.presupuestos.filter(function (x) { return x.id === id; })[0];
    db.ref('crm/seguimientos/' + id).push({ fecha: Date.now(), por: S.user.email, empresa: p ? p.empresa : '' })
      .then(function () { if (p) p.seguimientos++; toast('Seguimiento anotado'); render(); })
      .catch(function (e) { toast('No se pudo guardar: ' + e.message); });
  }

  // Guarda en Firebase lo que Dami registra desde la ficha.
  function registrar(key, form) {
    var c = S.M.porKey[key]; if (!c) return;
    var el = function (n) { return form.elements.namedItem(n).value; };
    var etapa = el('etapa'), nota = el('nota').trim(), fecha = el('fecha'), paso = el('paso').trim();
    if (!etapa && !nota && !fecha) { toast('No hay nada para guardar'); return; }
    var hoyTxt = D.ymd(new Date());
    var texto = (etapa && etapa !== c.etapa ? '[' + etapa + '] ' : '') + (nota || (etapa ? 'Cambio de etapa' : 'Próxima acción actualizada')) + ' (Dami, desde la plataforma)';
    var tareas = [];
    if (c.fuente === 'pipeline') {
      var upd = {};
      if (etapa && D.ESTADO_RAW.pipeline[etapa]) upd.estado = D.ESTADO_RAW.pipeline[etapa];
      if (fecha) upd.proxFecha = fecha;
      if (paso) upd.proxPaso = paso;
      upd._lastEdit = Date.now();
      tareas.push(db.ref('leads/' + c.leadId).update(upd));
      tareas.push(db.ref('leads/' + c.leadId + '/historial').transaction(function (h) {
        var arr = Array.isArray(h) ? h : (h ? Object.keys(h).map(function (k) { return h[k]; }) : []);
        return arr.concat([{ fecha: hoyTxt, quien: 'Dami', tipo: 'plataforma', contenido: texto }]);
      }));
    } else {
      var oid = c.outId || (c.campanas[0] && c.campanas[0].id);
      var u2 = { _lastEdit: Date.now() };
      if (etapa && D.ESTADO_RAW.outreach[etapa]) u2.estado = D.ESTADO_RAW.outreach[etapa];
      if (fecha) u2.proxSeguimiento = fecha;
      tareas.push(db.ref('outreach/' + oid).update(u2));
      tareas.push(db.ref('outreach/' + oid + '/historial').transaction(function (h) {
        var arr = Array.isArray(h) ? h : (h ? Object.keys(h).map(function (k) { return h[k]; }) : []);
        return arr.concat([{ f: hoyTxt, t: texto + (paso ? ' Próxima acción: ' + paso : '') }]);
      }));
    }
    form.querySelector('button[type=submit]').disabled = true;
    Promise.all(tareas).then(function () { toast('Guardado en la base'); cargar(); })
      .catch(function (e) { toast('No se pudo guardar: ' + e.message); form.querySelector('button[type=submit]').disabled = false; });
  }

  // ---------- pantallas ----------
  function shell(body, on) {
    var links = [['tablero', 'Tablero'], ['campanas', 'Campañas'], ['contactos', 'Contactos'], ['presupuestos', 'Presupuestos'], ['finanzas', 'Finanzas'], ['aprobar', 'Aprobar' + (nAprobar() ? ' (' + nAprobar() + ')' : '')], ['sistema', 'Sistema']];
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
    else if (v === 'aprobar') body = vAprobar();
    else if (v === 'sistema') body = vSistema();
    else { v = 'tablero'; body = vTablero(); }
    app.innerHTML = shell(body, v === 'contacto' ? 'contactos' : v);
  }

  // ---------- presupuestos ----------
  function contactoDe(p) { return S.M.contactos.filter(function (x) { return x.presupuestos.indexOf(p) >= 0; })[0]; }
  function docsDe(p) {
    var out = [];
    p.links.forEach(function (u, i) { out.push('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + (/document|docx|\.doc/.test(u) ? 'Doc' : 'Archivo') + (p.links.length > 1 ? ' ' + (i + 1) : '') + '</a>'); });
    p.docs.forEach(function (f) { if (p.links.join(' ').indexOf(f.id) < 0) out.push('<a href="' + esc(f.webViewLink || ('https://drive.google.com/file/d/' + f.id + '/view')) + '" target="_blank" rel="noopener" title="' + esc(f.name) + '">' + esc(f.name.replace(/\.(docx|pdf)$/i, '').replace(/^\s*20\d\d_\d{1,2}_?\s*/, '').slice(0, 42)) + '</a>'); });
    out.push('<a href="' + gmailLink(p.empresa.split(/[\s(-]/)[0] + ' presupuesto') + '" target="_blank" rel="noopener">Gmail</a>');
    return '<div class="small" style="display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px">' + out.join('') + '</div>';
  }
  function montoDe(p) {
    if (p.usd != null && p.ars != null) return money(p.ars, 'ARS') + '<br>' + money(p.usd, 'USD');
    return p.usd != null ? money(p.usd, 'USD') : money(p.ars, 'ARS');
  }
  function tablaPresupuestos(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<p class="mut">No hay presupuestos para mostrar.</p>';
    return '<div class="scroll"><table class="t" style="min-width:860px"><thead><tr><th>Empresa / trabajo</th><th style="text-align:right">Monto</th><th>Estado</th><th style="text-align:right">' + (opts.fecha ? 'Envío' : 'Días del envío') + '</th>' + (opts.fecha ? '' : '<th>Seguimientos</th>') + '<th>Próxima acción</th></tr></thead><tbody>' +
      rows.map(function (p) {
        var c = contactoDe(p);
        var nombre = c ? '<a href="#/contacto/' + encodeURIComponent(c.key) + '" style="color:inherit;text-decoration:none">' + esc(p.empresa) + '</a>' : esc(p.empresa);
        return '<tr><td>· ' + nombre + (p.anio !== 2026 ? ' <span class="cond small mut">' + p.anio + '</span>' : '') + '<div class="mut small" style="padding-left:10px;margin-top:3px">' + esc(p.trabajo) + (p.canal ? ' · ' + esc(p.canal) : '') + '</div>' + docsDe(p) + '</td>' +
          '<td class="num">' + montoDe(p) + '</td><td>' + stateTag(p) + '</td>' +
          (opts.fecha ? '<td class="num">' + fdate(p.envio) + '</td>' :
            '<td class="num" style="color:' + (p.dias > 14 ? '#E8604C' : p.dias > 7 ? '#F2A93B' : '#E6E8EF') + '">' + (p.dias == null ? '—' : p.dias) + '</td>' +
            '<td style="white-space:nowrap">' + p.seguimientos + ' <button class="btn sm" data-seg="' + esc(p.id) + '" aria-label="Anotar un seguimiento a ' + esc(p.empresa) + '">+1</button></td>') +
          '<td style="white-space:nowrap;color:' + (p.vencido ? '#E8604C' : '#E6E8EF') + '">' + (p.abierto ? (p.vencido ? 'Vencido ' : '') + fdate(p.prox) : '—') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  var GRUPOS = [['enviado', 'Enviados', function (p) { return p.estadoNum === 2; }], ['pausa', 'En pausa', function (p) { return p.estadoNum === 3 && p.estado !== 'Sin respuesta'; }],
    ['sinresp', 'Sin respuesta', function (p) { return p.estado === 'Sin respuesta'; }], ['nuevo', 'Nuevos', function (p) { return p.estadoNum === 1; }]];

  // ---------- tablero ----------
  function paraCoordinar(n) {
    return S.M.contactos.filter(function (c) { return !c.clienteActivo && ['Reunión', 'Respondió'].indexOf(c.etapa) >= 0 && c.ultimo && D.daysBetween(c.ultimo, S.M.hoy) <= 45; })
      .sort(function (a, b) { return b.importancia - a.importancia; }).slice(0, n || 6);
  }
  function cardContacto(c) {
    var camp = campDe(c.campana);
    var col = c.etapa === 'Reunión' ? '#4FB8A8' : '#F2A93B';
    return '<li><a class="card" style="border-left-color:' + col + '" href="#/contacto/' + encodeURIComponent(c.key) + '"><div class="cond small" style="display:flex;justify-content:space-between;gap:8px"><span style="color:' + col + '">' + esc(c.etapa) + '</span><span class="mut">' + esc(camp ? camp.nombre : 'Pipeline') + ' · ' + fdate(c.ultimo) + '</span></div>' +
      '<div style="margin-top:6px;font-size:17px">' + esc(c.nombre || c.empresa) + '</div><div class="mut">' + esc(c.empresa) + '</div>' +
      (c.ultimoTexto ? '<div class="small soft" style="margin-top:6px;line-height:1.45">' + esc(c.ultimoTexto.slice(0, 150)) + '</div>' : '') + '</a></li>';
  }

  function vTablero() {
    var M = S.M, P = M.pres26;
    var env = P.filter(GRUPOS[0][2]), pausa = P.filter(GRUPOS[1][2]), sinr = P.filter(GRUPOS[2][2]), nuevos = P.filter(GRUPOS[3][2]);
    var venc = env.concat(nuevos).filter(function (p) { return p.vencido; });
    var aprob = P.filter(function (p) { return p.estadoNum === 4; });
    var activos = env.concat(nuevos);
    var refArs = activos.reduce(function (s, p) { return s + (p.ars || 0); }, 0), refUsd = activos.reduce(function (s, p) { return s + (p.usd || 0); }, 0);
    var maxDias = Math.max.apply(null, [1].concat(activos.map(function (p) { return p.dias || 0; })));
    var maxSeg = Math.max.apply(null, [3].concat(activos.map(function (p) { return p.seguimientos; })));
    var hoy = D.startOfDay(M.hoy);

    var paraHoy = [];
    activos.forEach(function (p) { if (p.prox && D.startOfDay(p.prox) <= hoy) paraHoy.push({ fecha: p.prox, quien: p.empresa, que: p.paso || p.trabajo, tipo: 'PRES', venc: p.vencido }); });
    M.contactos.forEach(function (c) { if (c.fuente === 'pipeline' && !c.clienteActivo && c.proxFecha && D.startOfDay(c.proxFecha) <= hoy && c.etapa !== 'Perdido') paraHoy.push({ fecha: c.proxFecha, quien: (c.nombre ? c.nombre + ' · ' : '') + c.empresa, que: c.proxPaso, tipo: 'LEAD', key: c.key, venc: D.startOfDay(c.proxFecha) < hoy }); });
    paraHoy.sort(function (a, b) { return a.fecha - b.fecha; });

    var coord = paraCoordinar(6);
    var c1 = M.campanas.filter(function (c) { return !c.historica; });
    var hora = new Date().getHours();
    var saludo = hora < 13 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';

    var nA = nAprobar();
    return (nA ? '<a class="card" href="#/aprobar" style="padding:18px 20px;display:flex;justify-content:space-between;gap:12px;align-items:center"><span style="font-size:18px">' + nA + ' mensaje' + (nA > 1 ? 's esperan' : ' espera') + ' tu aprobación</span><span class="cond" style="color:#F2A93B">Revisar →</span></a>' : '') + '<section style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:24px"><div><p class="eyebrow">' + M.hoy.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) + '</p><h1>' + saludo + ', Dami.</h1></div>' +
      '<p class="soft" style="margin:0;max-width:460px;line-height:1.5">' + env.length + ' presupuestos enviados en juego' + (venc.length ? ', <span style="color:#E8604C">' + venc.length + ' con la próxima acción vencida</span>' : '') + ', ' + coord.length + ' contactos para coordinar y ' + paraHoy.length + ' cosas para hoy.</p></section>' +

      '<section class="hero" aria-label="Presupuestos en juego"><div class="gauge">' +
      '<svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="' + env.length + ' presupuestos enviados en juego"><circle cx="100" cy="100" r="82" fill="none" stroke="#343A50" stroke-width="4" stroke-dasharray="386 515" transform="rotate(135 100 100)"/>' +
      '<circle cx="100" cy="100" r="82" fill="none" stroke="#F2A93B" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + Math.round(386 * Math.min(1, env.length / Math.max(env.length + 3, 7))) + ' 515" transform="rotate(135 100 100)"/>' +
      '<text x="100" y="108" text-anchor="middle" fill="#E6E8EF" font-family="Barlow" font-weight="300" font-size="64">' + env.length + '</text><text x="100" y="136" text-anchor="middle" fill="#8A90A6" font-family="Barlow Semi Condensed" font-size="14" letter-spacing="2">ENVIADOS</text></svg>' +
      '<p style="margin:6px 0 0;font-size:16px">Presupuestos en juego</p><p class="cond mut small" style="margin:4px 0 0">' + (nuevos.length ? nuevos.length + ' nuevo' + (nuevos.length > 1 ? 's' : '') + ' en la planilla · ' : '') + (pausa.length + sinr.length) + ' enviados antes, en pausa o sin respuesta</p>' +
      '<p class="cond small" style="margin:2px 0 0;color:#7D8299">Referencia interna: ARS ' + millones(refArs) + (refUsd ? ' · USD ' + miles(refUsd) : '') + '</p></div>' +
      '<div class="grow bars"><div class="sechead src"><span>Días del envío, seguimientos y estado</span><span><span style="display:inline-block;width:10px;height:10px;background:#F2A93B;margin-right:6px"></span>Días &nbsp; <span style="display:inline-block;width:10px;height:10px;background:#8C90CF;margin-right:6px"></span>Seguimientos</span></div>' +
      activos.map(function (p) {
        return '<div class="b"><div class="t"><span>· ' + esc(p.empresa) + '</span><span>' + stateTag(p) + ' <span style="color:#F2A93B">' + (p.dias == null ? 'sin fecha de envío' : p.dias + ' días') + '</span><span style="color:#5C6380"> / </span>' + p.seguimientos + ' seg.</span></div>' +
          '<div class="track"><div style="width:' + (p.dias == null ? 0 : Math.max(2, p.dias * 100 / maxDias)) + '%;background:#F2A93B"></div></div>' +
          '<div class="track" style="margin-top:5px"><div style="width:' + (p.seguimientos * 100 / maxSeg) + '%;background:#8C90CF"></div></div></div>';
      }).join('') + '</div></section>' +

      '<section class="rings" aria-label="Estado de presupuestos">' +
      [[env.length, 'Enviados', 'esperando respuesta', '#F2A93B'], [venc.length, 'Vencidos', 'próxima acción pasada', '#E8604C'], [pausa.length, 'En pausa', 'para retomar con fecha', '#8C90CF'], [sinr.length, 'Sin respuesta', 'enviados que no contestaron', '#7D8299'], [aprob.length, 'Aprobados', 'en el año', '#E6E8EF']]
        .map(function (x) { return '<div class="ring">' + ring(x[0], Math.max(P.length / 3, x[0]), x[3]) + '<p>' + x[1] + '</p><p class="cond mut small" style="margin-top:2px">' + x[2] + '</p></div>'; }).join('') + '</section>' +

      '<div class="row"><section class="grow" aria-labelledby="t-pres"><div class="sechead"><h2 id="t-pres">Presupuestos enviados</h2><span class="src">en vivo · planilla Presupuesto 2026</span></div>' +
      tablaPresupuestos(activos) + '<p class="src" style="margin-top:12px">El +1 anota un seguimiento hecho. La planilla sigue mandando: acá se lee, se carga allá. <a href="#/presupuestos">Buscar en todos los presupuestos</a></p></section>' +
      '<aside class="side"><section aria-labelledby="t-coord"><h2 id="t-coord" style="margin-bottom:14px">Para coordinar</h2>' +
      (coord.length ? '<ul class="list">' + coord.map(cardContacto).join('') + '</ul>' : '<p class="mut">No hay reuniones ni respuestas recientes.</p>') + '<p class="src" style="margin-top:10px">Reuniones y respuestas de los últimos 45 días, de todas las campañas.</p></section>' +
      '<section aria-labelledby="t-hoy"><h2 id="t-hoy" style="margin-bottom:14px">Para hoy</h2>' +
      (paraHoy.length ? '<ol class="list">' + paraHoy.slice(0, 8).map(function (x) {
        var inner = '<div class="cond small" style="display:flex;justify-content:space-between;color:' + (x.venc ? '#E8604C' : '#F2A93B') + '"><span>' + x.tipo + '</span><span>' + (x.venc ? 'vencido ' : '') + fdate(x.fecha) + '</span></div><div style="margin-top:6px">' + esc(x.quien) + '</div><div class="mut small" style="margin-top:4px;line-height:1.45">' + esc((x.que || '').slice(0, 160)) + '</div>';
        return '<li>' + (x.key ? '<a class="card" style="border-left-color:' + (x.venc ? '#E8604C' : '#F2A93B') + '" href="#/contacto/' + encodeURIComponent(x.key) + '">' + inner + '</a>' : '<div class="card" style="border-left-color:' + (x.venc ? '#E8604C' : '#F2A93B') + '">' + inner + '</div>') + '</li>';
      }).join('') + '</ol>' + (paraHoy.length > 8 ? '<p class="src">y ' + (paraHoy.length - 8) + ' más</p>' : '') : '<p class="mut">Nada pendiente para hoy.</p>') + '</section></aside></div>' +

      '<section aria-labelledby="t-camp"><div class="sechead"><h2 id="t-camp">Campañas</h2><a href="#/campanas" class="small">Ver detalle</a></div><div class="camps">' +
      c1.map(cardCampana).join('') + '</div></section>' +
      (S.fin ? bloqueObjetivo(true) : '');
  }

  function cardCampana(k) {
    var cells = k.id === 'exclientes'
      ? [[k.total, 'En la lista'], [k.enviados, 'Contactados'], [k.ganados, 'Aprobados'], ['—', '']]
      : [[k.enviados, 'Enviados'], [k.respondieron, 'Respondieron'], [k.reuniones, 'Reuniones'], [k.presupuestos, 'Presupuestos']];
    var base = k.id === 'exclientes' ? k.total : k.enviados;
    var r2 = k.id === 'exclientes' ? k.enviados : k.respondieron;
    var top = (k.importantes || []).slice(0, 3);
    return '<a class="card" style="border-left-color:' + k.color + ';padding:20px" href="#/campanas/' + k.id + '"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px"><span style="font-size:18px">' + esc(k.nombre) + '</span>' +
      '<span class="cond small mut">' + (k.id === 'exclientes' ? '' : 'respuesta ' + pct(k.respondieron, k.enviados)) + '</span></div><div class="kgrid">' +
      cells.map(function (c, i) { return '<div><div class="n" style="color:' + (i === 1 ? '#F2A93B' : i === 0 ? '#8C90CF' : '#E6E8EF') + '">' + (c[0] == null ? '—' : c[0]) + '</div><div class="l">' + c[1] + '</div></div>'; }).join('') + '</div>' +
      '<div class="track" style="margin-top:14px"><div style="width:100%;background:#8C90CF"></div></div><div class="track" style="margin-top:5px"><div style="width:' + (base ? r2 * 100 / base : 0) + '%;background:#F2A93B"></div></div>' +
      (top.length ? '<div class="small" style="margin-top:14px;display:flex;flex-direction:column;gap:4px">' + top.map(function (c) { return '<div style="display:flex;justify-content:space-between;gap:8px"><span>' + esc(c.nombre || c.empresa) + ' <span class="mut">· ' + esc(c.empresa) + '</span></span><span style="color:' + (ETAPA_COLOR[c.etapa] || '#8A90A6') + '">' + esc(c.etapa) + '</span></div>'; }).join('') + '</div>' : '') + '</a>';
  }

  function vCampana(id) {
    var M = S.M, k = campDe(id) || M.campanas[0];
    var tabs = '<div class="tabs" role="tablist">' + M.campanas.map(function (c) { return '<a class="tab' + (c.id === k.id ? ' on' : '') + '" role="tab" aria-selected="' + (c.id === k.id) + '" href="#/campanas/' + c.id + '">' + esc(c.nombre) + '</a>'; }).join('') + '</div>';
    var head = '<section style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:24px"><div style="max-width:720px"><p class="eyebrow" style="color:' + k.color + '">' + (k.historica ? 'Cerrada' : 'Activa') + (k.ultimoEnvio ? ' · último envío ' + fdate(k.ultimoEnvio) : '') + '</p><h1>' + esc(k.nombre) + '</h1><p class="soft" style="line-height:1.55">' + esc(k.desc) + '</p></div>' +
      '<dl class="kv" style="align-content:start"><dt>Canales</dt><dd>' + esc(k.canales) + '</dd><dt>Firma</dt><dd>' + esc(k.firma) + '</dd></dl></section>';
    if (k.id === 'exclientes') return tabs + head + vExClientes(k);

    var imp = '<section aria-labelledby="t-imp"><div class="sechead"><h2 id="t-imp">Los más importantes</h2><span class="src">reuniones, presupuestos y respuestas, primero lo más avanzado</span></div>' +
      (k.importantes.length ? '<ul class="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">' + k.importantes.slice(0, 9).map(cardContacto).join('') + '</ul>' +
        (k.importantes.length > 9 ? '<p class="src">y ' + (k.importantes.length - 9) + ' más en la lista de abajo</p>' : '') : '<p class="mut">Todavía nadie respondió en esta campaña.</p>') + '</section>';

    var steps = [['Enviados', k.enviados, ''], ['Respondieron', k.respondieron, pct(k.respondieron, k.enviados)], ['Reunión', k.reuniones, pct(k.reuniones, k.respondieron)], ['Presupuesto', k.presupuestos, pct(k.presupuestos, k.respondieron)], ['Ganado', k.ganados, pct(k.ganados, k.presupuestos)]];
    var max = Math.max(1, k.enviados);
    var funnel = '<section aria-labelledby="t-emb"><div class="sechead"><h2 id="t-emb">Embudo</h2><span class="src">' + k.rebotados + ' rebotados · ' + k.muertos + ' sin respuesta tras el seguimiento</span></div><div class="funnel">' +
      steps.map(function (s, i) { return '<div class="f"><span class="soft">' + s[0] + '</span><div class="bar"><div style="width:' + Math.max(s[1] ? 1 : 0, s[1] * 100 / max) + '%;background:' + k.color + ';opacity:' + (1 - i * 0.13) + '"></div></div><span class="cond" style="text-align:right">' + s[1] + (s[2] ? ' · ' + s[2] : '') + '</span></div>'; }).join('') +
      '</div><p class="src" style="margin-top:12px">El porcentaje es el paso de una etapa a la siguiente, para ver dónde se traba.</p></section>';
    var maxS = Math.max.apply(null, [1].concat(k.semanas.map(function (s) { return s.n; })));
    var semanas = '<section style="flex:1 1 380px;min-width:0"><h2 style="margin-bottom:18px">Envíos por semana</h2><div style="display:flex;align-items:flex-end;gap:10px;height:140px">' +
      k.semanas.map(function (s) { return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%"><span class="cond small">' + (s.n || '') + '</span><div style="width:100%;max-width:26px;height:' + (s.n * 110 / maxS) + 'px;background:#8C90CF"></div><span class="cond small mut" style="margin-top:6px">' + fdate(s.ini) + '</span></div>'; }).join('') + '</div></section>';
    var rubros = '<section style="flex:1 1 380px;min-width:0"><h2 style="margin-bottom:12px">Quién responde, por rubro</h2>' + (k.rubros.length ? k.rubros.map(function (r) { return '<div style="display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #2C3246"><span>' + esc(r.rubro) + '</span><span class="cond"><span style="color:#F2A93B">' + pct(r.resp, r.n) + '</span> <span class="mut">de ' + r.n + '</span></span></div>'; }).join('') : '<p class="mut">Todavía no hay rubros cargados en esta campaña.</p>') + '</section>';
    return tabs + head + imp + funnel + '<div class="row">' + semanas + rubros + '</div>' +
      '<section><div class="sechead"><h2>Contactos de la campaña</h2><a class="small" href="#/contactos" data-camp="' + k.id + '">Ver en Contactos con filtros</a></div>' + tablaContactos(k.contactos.slice(0, 60)) +
      (k.contactos.length > 60 ? '<p class="src">Mostrando 60 de ' + k.contactos.length + '. El resto, en Contactos.</p>' : '') + '</section>';
  }

  function vExClientes(k) {
    var est = Object.keys(k.porEstado).sort();
    return '<section><div class="sechead"><h2>Estado de la lista</h2><span class="src">en vivo · planilla POSIBLES PROYECTOS</span></div><div class="rings">' +
      est.map(function (e) { return '<div class="ring">' + ring(k.porEstado[e], k.total, '#8C90CF') + '<p>' + esc(e.replace(/^\d+\s*-\s*/, '')) + '</p></div>'; }).join('') + '</div></section>' +
      '<section><h2 style="margin-bottom:16px">Lista</h2><div class="scroll"><table class="t" style="min-width:900px"><thead><tr><th>Empresa</th><th>Qué se le propone</th><th>Estado</th><th>Envío</th><th>Próxima</th><th>Próximo paso</th></tr></thead><tbody>' +
      k.filas.map(function (p, i) {
        var cab = p.grupo && (i === 0 || k.filas[i - 1].grupo !== p.grupo) ? '<tr><td colspan="6" class="cond small" style="color:#8C90CF;letter-spacing:.08em;padding-top:22px">' + esc(p.grupo) + '</td></tr>' : '';
        var venc = p.prox && D.startOfDay(p.prox) < D.startOfDay(S.M.hoy) && p.estadoNum >= 1 && p.estadoNum !== 4 && p.estadoNum !== 5;
        return cab + '<tr><td>· ' + esc(p.empresa) + (p.medio ? '<div class="mut small" style="padding-left:10px;margin-top:3px">' + esc(p.medio) + '</div>' : '') + '</td><td class="soft small">' + esc(p.propuesta.slice(0, 140)) + '</td><td class="small">' + esc(p.estado.replace(/^\d+\s*-\s*/, '')) + '</td><td>' + fdate(p.envio) + '</td><td style="color:' + (venc ? '#E8604C' : '#E6E8EF') + '">' + fdate(p.prox) + '</td><td class="soft small" title="' + esc(p.obs) + '">' + esc(p.paso.slice(0, 120)) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></section>';
  }

  function tablaContactos(rows) {
    if (!rows.length) return '<p class="mut">No hay contactos con ese filtro.</p>';
    return '<div class="scroll"><table class="t" style="min-width:860px"><thead><tr><th>Contacto</th><th>Rubro</th><th>Campaña</th><th>Etapa</th><th>Último movimiento</th></tr></thead><tbody>' +
      rows.map(function (c) {
        var camp = campDe(c.campana);
        return '<tr><td><a href="#/contacto/' + encodeURIComponent(c.key) + '" style="color:#E6E8EF;text-decoration:none">' + esc(c.nombre || '(sin nombre)') + '</a><div class="mut small" style="margin-top:3px">' + esc(c.empresa) + (c.cargo ? ' · ' + esc(c.cargo) : '') + '</div></td>' +
          '<td class="soft small">' + esc(c.rubro) + '</td><td class="small" style="color:' + (camp ? camp.color : '#8A90A6') + '">' + esc(camp ? camp.nombre : c.fuente === 'pipeline' ? 'Pipeline' : '') + '</td><td>' + etapaTag(c.etapa) + '</td><td class="mut">' + fdate(c.ultimo) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function filtrarContactos() {
    var f = S.filtro, q = D.norm(f.q);
    return S.M.contactos.filter(function (c) {
      if (f.etapa && c.etapa !== f.etapa) return false;
      if (f.camp && c.campana !== f.camp) return false;
      if (q && D.norm(c.nombre + ' ' + c.empresa + ' ' + c.rubro + ' ' + c.cargo).indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return b.importancia - a.importancia; });
  }

  function vContactos() {
    var f = S.filtro, M = S.M, rows = filtrarContactos();
    var etapas = D.ORDEN.slice().reverse();
    var cuenta = {}; M.contactos.forEach(function (c) { cuenta[c.etapa] = (cuenta[c.etapa] || 0) + 1; });
    return '<section><p class="eyebrow">Base completa</p><h1>' + M.contactos.length + ' contactos</h1><p class="soft">Pipeline y prospección juntos, una ficha por persona. Primero lo más avanzado.</p></section>' +
      '<section><div class="filters" style="margin-bottom:18px"><label for="fq" style="position:absolute;left:-9999px">Buscar</label><input id="fq" class="in" placeholder="Buscar nombre, empresa, rubro o cargo" value="' + esc(f.q) + '">' +
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
    var campNom = c.campanas.map(function (r) { var k = campDe(r.campana); return (k ? k.nombre : r.campana) + (r.fechaEnvio ? ' (' + fdate(r.fechaEnvio) + ')' : ''); }).join(', ');
    var analisis = [c.resumen].concat(c.campanas.map(function (r) { return r.gancho || r.resumen; })).filter(Boolean);
    var opciones = ['Respondió', 'Reunión', 'En pausa', 'Perdido'];
    var form = '<section class="card" style="border-left-color:#8C90CF;padding:20px"><h2 style="font-size:18px;margin-bottom:14px">Registrar</h2>' +
      '<form data-registrar="' + esc(c.key) + '" style="display:flex;flex-direction:column;gap:10px">' +
      '<div class="filters"><label class="small mut" style="display:flex;flex-direction:column;gap:4px">Etapa<select class="in" name="etapa"><option value="">Sin cambio (' + esc(c.etapa) + ')</option>' + opciones.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') + '</select></label>' +
      '<label class="small mut" style="display:flex;flex-direction:column;gap:4px">Próxima acción<input class="in" type="date" name="fecha" style="min-width:0"></label></div>' +
      '<label class="small mut" style="display:flex;flex-direction:column;gap:4px">Qué hay que hacer<input class="in" name="paso" placeholder="Ej: reunión por Meet jueves 15:30" style="min-width:0;width:100%"></label>' +
      '<label class="small mut" style="display:flex;flex-direction:column;gap:4px">Qué pasó<textarea class="in" name="nota" rows="3" placeholder="Ej: hablamos por WhatsApp, quiere ver opciones de streaming para el congreso de noviembre" style="padding:10px 12px;min-height:80px;resize:vertical"></textarea></label>' +
      '<div><button class="btn pri" type="submit">Guardar en la base</button></div>' +
      '<p class="src" style="margin:0">Queda en el historial con la fecha de hoy. Presupuesto y Ganado salen solos de la planilla de presupuestos.</p></form></section>';
    return '<a href="#/contactos" class="small" style="text-decoration:none">← Contactos</a>' +
      '<section style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:24px"><div><p class="eyebrow">' + esc(c.empresa) + '</p><h1>' + esc(c.nombre || c.empresa) + '</h1>' + (c.cargo ? '<p class="soft" style="margin:10px 0 0">' + esc(c.cargo) + '</p>' : '') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px">' + (wpp ? '<a class="btn pri" style="display:inline-flex;align-items:center;text-decoration:none" href="https://wa.me/' + wpp + '" target="_blank" rel="noopener">WhatsApp</a>' : '') +
      (c.mail ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none;color:#E6E8EF" href="mailto:' + esc(c.mail) + '">Mail</a>' : '') +
      (c.linkedin ? '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none;color:#E6E8EF" href="' + esc(c.linkedin) + '" target="_blank" rel="noopener">LinkedIn</a>' : '') +
      '<a class="btn" style="display:inline-flex;align-items:center;text-decoration:none;color:#E6E8EF" href="' + gmailLink(c.mail || c.empresa) + '" target="_blank" rel="noopener">Buscar en Gmail</a></div></section>' +
      '<section aria-label="Etapa"><ol class="stages">' + orden.map(function (e, i) { var col = i < idx ? '#E6E8EF' : i === idx ? '#F2A93B' : '#343A50'; return '<li><div class="s" style="background:' + col + '"></div><div class="small" style="margin-top:8px;color:' + (i === idx ? '#F2A93B' : i < idx ? '#E6E8EF' : '#7D8299') + '">' + e + '</div></li>'; }).join('') + '</ol>' +
      (['Perdido', 'Sin respuesta', 'Rebotado'].indexOf(c.etapa) >= 0 ? '<p class="small" style="color:#E8604C;margin-top:10px">' + esc(c.etapa) + '</p>' : '') + '</section>' +
      '<div class="row"><div class="grow" style="display:flex;flex-direction:column;gap:40px">' +
      (c.proxFecha || c.proxPaso ? '<section class="card" style="border-left-color:' + (c.proxFecha && D.startOfDay(c.proxFecha) < D.startOfDay(S.M.hoy) ? '#E8604C' : '#F2A93B') + ';padding:20px"><div class="cond small mut">PRÓXIMA ACCIÓN · ' + fdate(c.proxFecha) + '</div><p style="margin:10px 0 0;font-size:17px;line-height:1.5">' + esc(c.proxPaso || '—') + '</p></section>' : '') +
      form +
      '<section><h2 style="margin-bottom:18px">Historial</h2>' + (c.historial.length ? '<ol class="timeline">' + c.historial.slice(0, 40).map(function (h) { return '<li><div class="cond small mut">' + fdate(h.fecha) + (h.quien ? ' · ' + esc(h.quien) : '') + (h.tipo ? ' · <span style="color:#F2A93B">' + esc(h.tipo) + '</span>' : '') + '</div><p class="txt">' + esc(h.texto) + '</p></li>'; }).join('') + '</ol>' : '<p class="mut">Sin historial cargado.</p>') + '</section></div>' +
      '<aside class="side">' +
      (c.presupuestos.length ? '<section><h2 style="margin-bottom:14px">Presupuestos</h2>' + c.presupuestos.map(function (p) { return '<div style="padding:12px 0;border-bottom:1px solid #2C3246"><div style="display:flex;justify-content:space-between;gap:10px"><span>' + esc(p.trabajo || p.empresa) + (p.anio !== 2026 ? ' <span class="mut small">' + p.anio + '</span>' : '') + '</span>' + stateTag(p) + '</div><div style="margin-top:6px;font-size:22px;font-weight:300">' + montoDe(p) + '</div><div class="cond small mut">' + (p.envio ? 'Enviado ' + fdate(p.envio) + ' · ' + p.dias + ' días' : 'Sin fecha de envío') + ' · ' + p.seguimientos + ' seguimientos</div>' + docsDe(p) + '</div>'; }).join('') + '</section>' : '') +
      '<section><h2 style="margin-bottom:14px">Datos</h2><dl class="kv">' +
      [['Mail', c.mail], ['WhatsApp', c.wpp], ['Rubro', c.rubro], ['Cómo llegó', [c.origen, c.medio].filter(Boolean).join(' · ')], ['Campaña', campNom], ['Etapa', c.etapa], ['Creado', fdate(c.creado)]]
        .filter(function (x) { return x[1]; }).map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl></section>' +
      (analisis.length ? '<section><h2 style="margin-bottom:12px">Lo que sabemos</h2>' + analisis.map(function (a) { return '<p class="soft" style="margin:0 0 10px;line-height:1.55">' + esc(a) + '</p>'; }).join('') + '</section>' : '') +
      '</aside></div>';
  }

  function buscarPresupuestos(q) {
    var t = D.norm(q).split(' ').filter(Boolean);
    if (!t.length) return [];
    return S.M.presupuestos.filter(function (p) {
      var hay = D.norm([p.empresa, p.trabajo, p.paso, p.obs, p.canal, p.ars, p.usd, p.docs.map(function (f) { return f.name; }).join(' ')].join(' '));
      return t.every(function (w) { return hay.indexOf(w) >= 0; });
    }).sort(function (a, b) { return (b.envio || b.prox || 0) - (a.envio || a.prox || 0); });
  }

  function vPresupuestos() {
    var P = S.M.pres26;
    var aprob = P.filter(function (p) { return p.estadoNum === 4; }), rech = P.filter(function (p) { return p.estadoNum === 5; });
    var tot = function (arr, k) { return arr.reduce(function (s, p) { return s + (p[k] || 0); }, 0); };
    var conArs = aprob.filter(function (p) { return p.ars; });
    var grupos = GRUPOS.concat([['aprob', 'Aprobados', function (p) { return p.estadoNum === 4; }], ['rech', 'Rechazados', function (p) { return p.estadoNum === 5; }]]);
    var sel = grupos.filter(function (g) { return g[0] === S.presTab; })[0] || grupos[0];
    var res = S.qPres ? buscarPresupuestos(S.qPres) : null;
    return '<section><p class="eyebrow">Planilla de presupuestos · en vivo</p><h1>' + P.length + ' presupuestos en 2026</h1><p class="soft">' + (S.M.presupuestos.length - P.length) + ' más de 2025 para buscar. ' + S.docs.length + ' documentos vinculados desde Drive.</p></section>' +
      '<section aria-labelledby="t-bus"><h2 id="t-bus" style="margin-bottom:12px">Buscar</h2><div class="filters"><label for="qp" style="position:absolute;left:-9999px">Buscar presupuestos</label><input id="qp" class="in" style="min-width:min(520px,100%)" placeholder="Empresa, trabajo, monto… ej: streaming abogados, Bedson 2025, 1080000" value="' + esc(S.qPres) + '"></div>' +
      (res ? '<div style="margin-top:16px">' + (res.length ? '<p class="src">' + res.length + ' resultado' + (res.length > 1 ? 's' : '') + '</p>' + tablaPresupuestos(res.slice(0, 50), { fecha: true }) : '<p class="mut">No encontré presupuestos con eso.</p>') + '</div>' : '') + '</section>' +
      '<section class="rings">' + grupos.map(function (g) { var n = P.filter(g[2]).length; var col = g[0] === 'enviado' ? '#F2A93B' : g[0] === 'pausa' ? '#8C90CF' : g[0] === 'sinresp' ? '#7D8299' : g[0] === 'nuevo' ? '#4FB8A8' : g[0] === 'aprob' ? '#E6E8EF' : '#5C6380'; return '<div class="ring">' + ring(n, P.length, col) + '<p>' + g[1] + '</p></div>'; }).join('') +
      '<div class="ring"><div style="font-size:44px;font-weight:300;margin-top:24px">' + pct(aprob.length, aprob.length + rech.length) + '</div><p>Tasa de cierre</p><p class="cond mut small">aprobados sobre resueltos</p></div></section>' +
      '<section class="row" style="gap:24px 56px"><div><p class="src">| Aprobado en el año</p><p style="margin:6px 0 0;font-size:28px;font-weight:300">ARS ' + millones(tot(aprob, 'ars')) + ' <span class="small mut">· USD ' + miles(tot(aprob, 'usd')) + '</span></p></div>' +
      '<div><p class="src">| Ticket promedio aprobado</p><p style="margin:6px 0 0;font-size:28px;font-weight:300">ARS ' + (conArs.length ? millones(tot(conArs, 'ars') / conArs.length) : '—') + '</p></div></section>' +
      '<section><div class="tabs" role="tablist" style="margin-bottom:16px">' + grupos.map(function (g) { return '<button class="tab' + (g === sel ? ' on' : '') + '" role="tab" aria-selected="' + (g === sel) + '" data-ptab="' + g[0] + '">' + g[1] + ' (' + P.filter(g[2]).length + ')</button>'; }).join('') + '</div>' +
      tablaPresupuestos(P.filter(sel[2]).sort(function (a, b) { return (b.envio || 0) - (a.envio || 0); }), { fecha: sel[0] === 'aprob' || sel[0] === 'rech' }) + '</section>';
  }

  // ---------- finanzas ----------
  function bloqueObjetivo(corto) {
    var F = S.fin; if (!F || !F.prom) return '';
    var mesAct = F.meses.filter(function (m) { return m.idx === new Date().getMonth(); })[0];
    var pe = F.prom.egr + OBJ * 2;
    var hecho = mesAct && mesAct.tot ? mesAct.tot.ing : 0;
    var falta = Math.max(0, pe - hecho);
    var tasa = S.blueHoy || (mesAct && mesAct.tasa);
    var env = S.M.pres26.filter(function (p) { return p.estadoNum === 2 || p.estadoNum === 1; });
    var pipeUsd = env.reduce(function (s, p) { return s + (p.usd || 0) + (p.ars && tasa ? p.ars / tasa : 0); }, 0);
    var w = Math.min(100, hecho * 100 / pe);
    return '<section aria-labelledby="t-obj"><div class="sechead"><h2 id="t-obj">' + (mesAct ? esc(mesAct.mes) : 'Este mes') + ' contra el punto de equilibrio</h2><span class="src">en dólares blue · ' + (corto ? '<a href="#/finanzas">Ver finanzas</a>' : 'objetivo ' + usd(OBJ) + ' por socio') + '</span></div>' +
      '<div class="row" style="gap:24px 48px;align-items:flex-end"><div><p class="src">| Facturado</p><p style="margin:6px 0 0;font-size:34px;font-weight:300">' + usd(hecho) + '</p></div>' +
      '<div><p class="src">| Punto de equilibrio</p><p style="margin:6px 0 0;font-size:34px;font-weight:300">' + usd(pe) + '</p><p class="cond small mut" style="margin:2px 0 0">costos ' + usd(F.prom.egr) + ' + retiros ' + usd(OBJ * 2) + '</p></div>' +
      '<div><p class="src">| Falta</p><p style="margin:6px 0 0;font-size:34px;font-weight:300;color:' + (falta ? '#E8604C' : '#4FB8A8') + '">' + (falta ? usd(falta) : 'Cubierto') + '</p></div>' +
      '<div><p class="src">| Presupuestos enviados</p><p style="margin:6px 0 0;font-size:34px;font-weight:300;color:#F2A93B">' + usd(pipeUsd) + '</p><p class="cond small mut" style="margin:2px 0 0">' + (falta ? 'cubren ' + pct(Math.min(pipeUsd, falta), falta) + ' de lo que falta si salen todos' : 'referencia interna') + '</p></div></div>' +
      '<div class="track" style="height:8px;margin-top:20px"><div style="height:8px;width:' + w + '%;background:' + (w >= 100 ? '#4FB8A8' : '#F2A93B') + '"></div></div></section>';
  }

  function vFinanzas() {
    var F = S.fin;
    if (!F) return '<p class="mut">No se pudo leer la planilla de Ganancias y pérdidas.</p>';
    var act = F.meses.filter(function (m) { return m.activo; });
    var usaUsd = F.conTasa;
    var pe = F.prom ? F.prom.egr + OBJ * 2 : null;
    var val = function (m) { return usaUsd ? m.tot.ing : m.ars.ing; };
    var max = Math.max.apply(null, [1, pe || 0].concat(act.map(val)));
    var W = 680, n = act.length, bw = (W - 60) / Math.max(1, n);
    var y = function (v) { return 180 - v * 160 / max; };
    var chart = '<svg viewBox="0 0 ' + W + ' 215" width="100%" role="img" aria-label="Ingresos por mes' + (usaUsd ? ' en dólares contra el punto de equilibrio' : '') + '"><g stroke="#343A50">' + [20, 60, 100, 140, 180].map(function (v) { return '<line x1="40" y1="' + v + '" x2="' + (W - 10) + '" y2="' + v + '"/>'; }).join('') + '</g>' +
      act.map(function (m, i) { var v = val(m), x = 46 + i * bw; var ok = !pe || v >= pe; return '<rect x="' + x.toFixed(0) + '" y="' + y(v).toFixed(0) + '" width="' + (bw * 0.56).toFixed(0) + '" height="' + (180 - y(v)).toFixed(0) + '" fill="' + (ok ? '#F2A93B' : '#8C90CF') + '"/><text x="' + (x + bw * 0.28).toFixed(0) + '" y="200" text-anchor="middle" fill="#8A90A6" font-family="Barlow Semi Condensed" font-size="12">' + esc(m.mes.slice(0, 3)) + '</text>'; }).join('') +
      (pe && usaUsd ? '<line x1="40" x2="' + (W - 10) + '" y1="' + y(pe).toFixed(0) + '" y2="' + y(pe).toFixed(0) + '" stroke="#E8604C" stroke-width="1.5" stroke-dasharray="5 4"/><text x="' + (W - 12) + '" y="' + (y(pe) - 6).toFixed(0) + '" text-anchor="end" fill="#E8604C" font-family="Barlow Semi Condensed" font-size="12">equilibrio ' + usd(pe) + '</text>' : '') +
      '<text x="0" y="24" fill="#8A90A6" font-family="Barlow Semi Condensed" font-size="11">' + (usaUsd ? usd(max) : millones(max)) + '</text></svg>';
    var debajo = usaUsd ? act.filter(function (m) { return m.tot.ing < pe; }) : [];
    var topCli = F.clientes.filter(function (c) { return c.cliente !== 'Sin identificar'; });
    var totCli = F.clientes.reduce(function (s, c) { return s + (usaUsd ? c.usdEq : c.ars); }, 0);
    var cv = function (c) { return usaUsd ? c.usdEq : c.ars; };
    var top1 = topCli[0] ? cv(topCli[0]) : 0, top3 = topCli.slice(0, 3).reduce(function (s, c) { return s + cv(c); }, 0);
    var maxC = Math.max.apply(null, [1].concat(topCli.map(cv)));
    var totS = F.servicios.reduce(function (s, x) { return s + (usaUsd ? x.usdEq : x.ars); }, 0);
    var maxS = Math.max.apply(null, [1].concat(F.servicios.map(function (s) { return usaUsd ? s.usdEq : s.ars; })));

    return '<section><p class="eyebrow">Ganancias y pérdidas ' + F.anio + ' · en vivo</p><h1>Finanzas</h1><p class="soft">' + (usaUsd ? 'Pesos convertidos a dólar blue con el promedio de cada mes, más los ingresos en dólares.' : 'No pude traer la cotización del blue: se muestra en pesos.') + '</p></section>' +
      (F.prom ? '<section class="row" style="gap:24px 56px">' +
        '<div><p class="src">| Ingresos del año</p><p style="margin:6px 0 0;font-size:32px;font-weight:300">' + usd(F.usdTot.ing) + '</p><p class="cond mut" style="margin:2px 0 0">promedio ' + usd(F.prom.ing) + ' por mes</p></div>' +
        '<div><p class="src">| Costos operativos</p><p style="margin:6px 0 0;font-size:32px;font-weight:300">' + usd(F.prom.egr) + '</p><p class="cond mut" style="margin:2px 0 0">promedio por mes, sin retiros</p></div>' +
        '<div><p class="src">| Retiro por socio</p><p style="margin:6px 0 0;font-size:32px;font-weight:300;color:' + (F.prom.porSocio >= OBJ ? '#4FB8A8' : '#E8604C') + '">' + usd(F.prom.porSocio) + '</p><p class="cond mut" style="margin:2px 0 0">promedio por mes · objetivo ' + usd(OBJ) + '</p></div>' +
        '<div><p class="src">| Punto de equilibrio</p><p style="margin:6px 0 0;font-size:32px;font-weight:300">' + usd(pe) + '</p><p class="cond mut" style="margin:2px 0 0">' + (F.prom.ing >= pe ? usd(F.prom.ing - pe) + ' de colchón promedio (' + pct(F.prom.ing - pe, pe) + ')' : 'faltan ' + usd(pe - F.prom.ing) + ' por mes en promedio') + '</p></div></section>' : '') +
      bloqueObjetivo(false) +
      '<section><div class="sechead"><h2>Ingresos por mes</h2><span class="src"><span style="display:inline-block;width:10px;height:10px;background:#F2A93B;margin-right:6px"></span>sobre el equilibrio &nbsp; <span style="display:inline-block;width:10px;height:10px;background:#8C90CF;margin-right:6px"></span>debajo</span></div>' + chart +
      (debajo.length ? '<p class="src">' + debajo.length + ' de ' + act.length + ' meses quedaron debajo del equilibrio: ' + debajo.map(function (m) { return m.mes; }).join(', ') + '.</p>' : '') + '</section>' +
      '<section><div class="sechead"><h2>Mes a mes</h2><span class="src">pestaña Mensual</span></div><div class="scroll"><table class="t" style="min-width:820px"><thead><tr><th>Mes</th><th style="text-align:right">Ingresos ARS</th><th style="text-align:right">Egresos ARS</th><th style="text-align:right">Ingresos USD</th>' + (usaUsd ? '<th style="text-align:right">Blue prom.</th><th style="text-align:right">Total en USD</th><th style="text-align:right">Por socio USD</th>' : '<th style="text-align:right">Resultado ARS</th>') + '</tr></thead><tbody>' +
      act.map(function (m) { return '<tr><td>' + esc(m.mes) + '</td><td class="num">' + miles(m.ars.ing) + '</td><td class="num">' + miles(m.ars.egr) + '</td><td class="num">' + miles(m.usd.ing) + '</td>' +
        (usaUsd ? '<td class="num mut">' + miles(m.tasa) + '</td><td class="num">' + miles(m.tot.ing) + '</td><td class="num" style="color:' + (m.porSocio >= OBJ ? '#4FB8A8' : '#E8604C') + '">' + miles(m.porSocio) + '</td>' : '<td class="num">' + miles(m.ars.res) + '</td>') + '</tr>'; }).join('') +
      '</tbody></table></div></section>' +
      '<div class="row"><section style="flex:1 1 420px;min-width:0"><div class="sechead"><h2>Concentración por cliente</h2><span class="src">aproximado, por la descripción del ingreso</span></div>' +
      '<p class="soft" style="margin:0 0 14px">El primer cliente es el <b style="color:#F2A93B">' + pct(top1, totCli) + '</b> de lo cobrado en el año y los tres primeros el <b style="color:#F2A93B">' + pct(top3, totCli) + '</b>.</p>' +
      topCli.slice(0, 10).map(function (c) { return '<div class="bars"><div class="b"><div class="t"><span>· ' + esc(c.cliente) + '</span><span><span style="color:#F2A93B">' + (usaUsd ? usd(c.usdEq) : 'ARS ' + millones(c.ars)) + '</span><span class="mut"> · ' + pct(cv(c), totCli) + ' · ' + c.n + ' cobros</span></span></div><div class="track"><div style="width:' + (cv(c) * 100 / maxC) + '%;background:#F2A93B"></div></div></div></div>'; }).join('') + '</section>' +
      '<section style="flex:1 1 420px;min-width:0"><div class="sechead"><h2>Ingresos por servicio</h2><span class="src">pestaña Facturación</span></div>' +
      F.servicios.slice(0, 12).map(function (s) { var v = usaUsd ? s.usdEq : s.ars; return '<div class="bars"><div class="b"><div class="t"><span>· ' + esc(s.servicio) + '</span><span><span style="color:#8C90CF">' + (usaUsd ? usd(v) : 'ARS ' + millones(v)) + '</span><span class="mut"> · ' + pct(v, totS) + ' · ' + s.n + ' cobros</span></span></div><div class="track"><div style="width:' + (v * 100 / maxS) + '%;background:#8C90CF"></div></div></div></div>'; }).join('') + '</section></div>' +
      '<section class="card" style="border-left-color:#8C90CF;padding:20px"><h2 style="font-size:18px;margin-bottom:10px">Para medir mejor</h2><ul class="soft" style="margin:0;padding-left:18px;line-height:1.7">' +
      '<li>Una columna <b>Cliente</b> en Facturación: hoy el cliente se adivina por la descripción.</li>' +
      '<li><b>Fecha de cobro</b> y <b>número de factura</b>: con eso salen los días de cobro y lo facturado sin cobrar.</li>' +
      '<li>El <b>presupuesto</b> al que corresponde cada ingreso o gasto: así se ve el margen real de cada trabajo.</li>' +
      '<li><b>Retiros de socios</b> como movimiento propio: hoy se calculan como el resultado del mes dividido dos.</li></ul></section>';
  }

  // ---------- aprobar ----------
  // Cola de mensajes que arman las tareas en /leads/estadoAsistente/aprobar. Dami decide acá; el CARTERO despacha lo aprobado.
  function colaAprobar() {
    var ea = S.raw.leads && S.raw.leads.estadoAsistente;
    var q = (ea && ea.aprobar) || {};
    return Object.keys(q).map(function (id) { var x = q[id] || {}; x.id = id; return x; });
  }
  function nAprobar() { return colaAprobar().filter(function (x) { return !x.estado || x.estado === 'pendiente'; }).length; }
  var ORIGEN = { cerebro: 'Pipeline', linkedin: 'LinkedIn Vistage', campanas: 'Congresos y Eventos', cartero: 'Respuesta entrante', exclientes: 'Ex clientes' };

  function decidir(accion, id) {
    var card = document.querySelector('[data-item="' + id + '"]');
    var upd = { decididoTs: Date.now(), decididoPor: 'Dami' };
    if (card) {
      var ta = card.querySelector('textarea'), sel = card.querySelector('select');
      if (ta) upd.texto = ta.value;
      if (sel) upd.canal = sel.value;
    }
    if (accion === 'aprobar') upd.estado = 'aprobado';
    else if (accion === 'guardar') upd.estado = 'pendiente';
    else if (accion === 'pausar') { upd.estado = 'pausado'; upd.retomarTs = Date.now() + 7 * 86400000; }
    else if (accion === 'descartar') upd.estado = 'descartado';
    else if (accion === 'volver') { upd.estado = 'pendiente'; }
    db.ref('leads/estadoAsistente/aprobar/' + id).update(upd).then(function () {
      var x = S.raw.leads.estadoAsistente.aprobar[id]; Object.keys(upd).forEach(function (k) { x[k] = upd[k]; });
      toast({ aprobar: 'Aprobado: lo manda el cartero en su próxima pasada', guardar: 'Cambios guardados', pausar: 'Pausado 7 días', descartar: 'Descartado', volver: 'Vuelve a pendientes' }[accion]);
      render();
    }).catch(function (e) { toast('No se pudo guardar: ' + e.message); });
  }

  function cardAprobar(x) {
    var canales = [['wpp', 'WhatsApp'], ['mail', 'Mail'], ['linkedin', 'LinkedIn']];
    var ts = x.ts ? new Date(x.ts) : null;
    return '<li class="card" style="border-left-color:#F2A93B;padding:20px" data-item="' + esc(x.id) + '">' +
      '<div class="cond small mut" style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px"><span style="color:#F2A93B">' + esc(ORIGEN[x.creadoPor] || x.creadoPor || 'Tarea') + (x.campana ? ' · ' + esc(x.campana) : '') + '</span><span>' + (ts ? fdate(ts) + ' ' + ('0' + ts.getHours()).slice(-2) + ':' + ('0' + ts.getMinutes()).slice(-2) : '') + '</span></div>' +
      '<div style="margin-top:8px;font-size:18px">' + esc(x.nombre || x.empresa || '') + (x.nombre && x.empresa ? ' <span class="mut" style="font-size:15px">· ' + esc(x.empresa) + '</span>' : '') + '</div>' +
      (x.motivo ? '<p class="soft small" style="margin:6px 0 0;line-height:1.5">' + esc(x.motivo) + '</p>' : '') +
      '<label class="small mut" style="display:block;margin-top:12px">Mensaje<textarea class="in" rows="5" style="display:block;width:100%;margin-top:4px;padding:10px 12px;resize:vertical;line-height:1.5">' + esc(x.texto || '') + '</textarea></label>' +
      '<div class="filters" style="margin-top:10px;align-items:center"><label class="small mut">Canal <select class="in" style="margin-left:6px">' + canales.map(function (c) { return '<option value="' + c[0] + '"' + (x.canal === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn pri" data-apr="aprobar" data-id="' + esc(x.id) + '">Aprobar</button><button class="btn" data-apr="guardar" data-id="' + esc(x.id) + '">Guardar cambios</button>' +
      '<button class="btn" data-apr="pausar" data-id="' + esc(x.id) + '">Pausar 7 días</button><button class="btn" data-apr="descartar" data-id="' + esc(x.id) + '">Descartar</button></div></li>';
  }

  function vAprobar() {
    var q = colaAprobar().sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
    var pend = q.filter(function (x) { return !x.estado || x.estado === 'pendiente'; });
    var aprob = q.filter(function (x) { return x.estado === 'aprobado'; });
    var hoy = D.startOfDay(new Date()).getTime();
    var env = q.filter(function (x) { return x.estado === 'enviado' && (x.enviadoTs || 0) >= hoy - 6 * 86400000; }).sort(function (a, b) { return (b.enviadoTs || 0) - (a.enviadoTs || 0); });
    var paus = q.filter(function (x) { return x.estado === 'pausado'; });
    var fila = function (x, extra) { return '<li class="card" style="border-left-color:#343A50;padding:14px 18px"><div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px"><span>' + esc(x.nombre || x.empresa || '') + ' <span class="mut small">· ' + esc(x.empresa || '') + ' · ' + esc(x.canal || '') + '</span></span>' + (extra || '') + '</div><div class="small soft" style="margin-top:6px;line-height:1.45;white-space:pre-line">' + esc(String(x.texto || '').slice(0, 220)) + '</div>' + (x.error ? '<div class="small" style="color:#E8604C;margin-top:6px">' + esc(x.error) + '</div>' : '') + '</li>'; };
    return '<section><p class="eyebrow">Nada sale sin tu OK</p><h1>Para aprobar</h1><p class="soft" style="max-width:720px;line-height:1.55">Las tareas dejan acá los mensajes que necesitan tu visto bueno. Editá el texto si hace falta y aprobá: el cartero lo manda tal cual en su próxima pasada (9, 12, 15 y 18 hs).</p></section>' +
      '<section>' + (pend.length ? '<ul class="list" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px">' + pend.map(cardAprobar).join('') + '</ul>' : '<p class="mut">No hay nada esperando tu aprobación.</p>') + '</section>' +
      (aprob.length ? '<section><h2 style="margin-bottom:12px">Aprobados, esperando al cartero (' + aprob.length + ')</h2><ul class="list">' + aprob.map(function (x) { return fila(x, '<button class="btn sm" data-apr="volver" data-id="' + esc(x.id) + '">Frenar</button>'); }).join('') + '</ul></section>' : '') +
      (env.length ? '<section><h2 style="margin-bottom:12px">Enviados en los últimos 7 días (' + env.length + ')</h2><ul class="list">' + env.map(function (x) { return fila(x, '<span class="cond small mut">' + fdate(new Date(x.enviadoTs)) + '</span>'); }).join('') + '</ul></section>' : '') +
      (paus.length ? '<section><h2 style="margin-bottom:12px">Pausados (' + paus.length + ')</h2><ul class="list">' + paus.map(function (x) { return fila(x, '<button class="btn sm" data-apr="volver" data-id="' + esc(x.id) + '">Volver a pendientes</button>'); }).join('') + '</ul></section>' : '');
  }

  // ---------- sistema ----------
  // Semaforo: cada rol tiene su horario (hora Argentina, lun a vie). Se cruza con las corridas
  // registradas en /leads/estadoAsistente/historial/<rol>/<ts> (las escriben las tareas y, como
  // respaldo, esta pagina copia ahi cada reporte de roles/<rol> que ve).
  var ROLES = [
    { k: 'cerebro', n: 'Cerebro', d: 'Arma los borradores del día en Aprobar y te avisa. No envía.', h: [[8, 52]], gracia: 90 },
    { k: 'cartero', n: 'Cartero', d: 'El único que envía por WhatsApp y mail. Despacha lo aprobado y mira respuestas.', h: [[9, 0], [12, 0], [15, 0], [18, 0]], gracia: 60 },
    { k: 'linkedin', n: 'LinkedIn', d: 'Invitaciones Vistage (40 a 60 por día), respuestas y seguimientos.', h: [[9, 7], [11, 7], [13, 7], [16, 7], [18, 7]], gracia: 75 },
    { k: 'campanas', n: 'Campañas', d: 'Congresos y Eventos: 50 envíos de un tirón a la mañana.', h: [[9, 13]], gracia: 150 }];
  var SEM = { v: ['#4FB8A8', 'Funcionando'], a: ['#F2A93B', 'Con avisos'], r: ['#E8604C', 'No está corriendo'], g: ['#7D8299', 'Sin datos todavía'] };
  function tsNum(t) { return typeof t === 'number' ? t : Date.parse(t) || 0; }
  function hhmm(d) { return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function ea() { return (S.raw.leads && S.raw.leads.estadoAsistente) || {}; }
  function corridas(rol) {
    var h = (ea().historial || {})[rol] || {}, out = {};
    Object.keys(h).forEach(function (k) { var x = h[k] || {}; var t = tsNum(x.ts) || +k; if (t) out[t] = x; });
    var r = (ea().roles || {})[rol]; if (r && tsNum(r.ts)) { var t = tsNum(r.ts); if (!out[t]) out[t] = { ts: t, resumen: r.resumen, alertas: r.alertas, ok: true }; }
    return Object.keys(out).map(Number).sort(function (a, b) { return a - b; }).map(function (t) { var x = out[t]; return { ts: t, ok: x.ok !== false, resumen: x.resumen || '', alertas: x.alertas ? (Array.isArray(x.alertas) ? x.alertas.join(', ') : String(x.alertas)) : '', enviados: x.enviados }; });
  }
  // horarios esperados (hora Argentina) entre desde y hasta
  function esperados(r, desde, hasta) {
    var out = [], d = new Date(desde); d.setHours(0, 0, 0, 0);
    for (; d <= hasta; d = new Date(d.getTime() + 864e5)) {
      var dow = d.getDay(); if (dow === 0 || dow === 6) continue;
      r.h.forEach(function (hm) { var t = new Date(d); t.setHours(hm[0], hm[1], 0, 0); if (t >= desde && t <= hasta) out.push(t.getTime()); });
    }
    return out;
  }
  function proxima(r) {
    var l = esperados(r, new Date(), new Date(Date.now() + 5 * 864e5)); return l.length ? new Date(l[0]) : null;
  }
  function estadoRol(r) {
    var cs = corridas(r.k);
    if (!cs.length) return { sem: 'g', cs: cs, linea: [] };
    var ahora = Date.now(), desde = Math.max(cs[0].ts - 15 * 6e4, ahora - 3 * 864e5);
    var slots = esperados(r, new Date(desde), new Date(ahora - r.gracia * 6e4));
    // linea de tiempo: cada horario esperado con la corrida que le corresponde (o "no corrió")
    var usadas = {}, linea = [];
    slots.forEach(function (t, i) {
      var fin = i + 1 < slots.length ? slots[i + 1] - 15 * 6e4 : ahora;
      var c = cs.filter(function (x) { return x.ts >= t - 15 * 6e4 && x.ts < fin && !usadas[x.ts]; })[0];
      if (c) usadas[c.ts] = 1;
      linea.push({ slot: t, c: c || null });
    });
    cs.forEach(function (x) { if (!usadas[x.ts] && x.ts >= desde) linea.push({ slot: x.ts, c: x, extra: true }); });
    linea.sort(function (a, b) { return a.slot - b.slot; });
    var ult = linea.filter(function (x) { return !x.extra; }), n = ult.length;
    var faltan = 0; for (var i = n - 1; i >= 0 && !ult[i].c; i--) faltan++;
    var malas = 0; for (var j = n - 1; j >= 0 && ult[j].c && (!ult[j].c.ok); j--) malas++;
    var last = cs[cs.length - 1];
    var sem = faltan >= 2 || malas >= 2 ? 'r' : (faltan === 1 || malas === 1 || (last && last.alertas)) ? 'a' : 'v';
    return { sem: sem, cs: cs, linea: linea, faltan: faltan, malas: malas, last: last };
  }
  // respaldo: copiar al historial el ultimo reporte de cada rol si no estaba
  function espejarHistorial() {
    var e = ea(), roles = e.roles || {}, hist = e.historial || {};
    ROLES.forEach(function (r) {
      var x = roles[r.k]; if (!x || !tsNum(x.ts)) return;
      var t = tsNum(x.ts), h = hist[r.k] || {};
      var ya = Object.keys(h).some(function (k) { return (tsNum((h[k] || {}).ts) || +k) === t; });
      if (ya) return;
      var al = x.alertas ? (Array.isArray(x.alertas) ? x.alertas.join(', ') : String(x.alertas)) : '';
      var reg = { ts: t, ok: true, resumen: String(x.resumen || '').slice(0, 300), alertas: al.slice(0, 300), copiadoPor: 'plataforma' };
      db.ref('leads/estadoAsistente/historial/' + r.k + '/' + t).set(reg).then(function () {
        e.historial = e.historial || {}; e.historial[r.k] = e.historial[r.k] || {}; e.historial[r.k][t] = reg;
      }).catch(function () {});
    });
  }
  function dot(c, sz) { return '<span style="display:inline-block;width:' + (sz || 10) + 'px;height:' + (sz || 10) + 'px;border-radius:50%;background:' + c + ';flex:none"></span>'; }
  function vSistema() {
    var roles = ea().roles || {};
    var lista = function (s) { return (Array.isArray(s) ? s : String(s || '').split(/\s*,\s*(?=[A-ZÁÉÍÓÚ])|\n/)).filter(Boolean); };
    var est = ROLES.map(function (r) { return estadoRol(r); });
    var tira = '<section style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px">' + ROLES.map(function (r, i) {
      var s = SEM[est[i].sem];
      return '<a href="#sem-' + r.k + '" class="card" style="border-left-color:' + s[0] + ';display:flex;align-items:center;gap:14px;padding:16px 18px">' + dot(s[0], 22) +
        '<span><span style="font-size:18px">' + r.n + '</span><br><span class="cond small" style="color:' + s[0] + '">' + s[1] + '</span></span></a>';
    }).join('') + '</section>';
    var leyenda = '<p class="cond small mut" style="margin:10px 0 0;display:flex;flex-wrap:wrap;gap:6px 18px">' + ['v', 'a', 'r', 'g'].map(function (k) { return '<span style="display:inline-flex;align-items:center;gap:6px">' + dot(SEM[k][0], 8) + SEM[k][1] + '</span>'; }).join('') +
      '<span>· Rojo = faltaron 2 corridas seguidas o fallaron 2 seguidas. Amarillo = faltó o falló la última, o dejó alertas.</span></p>';
    return '<section><p class="eyebrow">Automatizaciones</p><h1>Sistema</h1><p class="soft" style="max-width:720px;line-height:1.55">El semáforo cruza el horario de cada tarea con las corridas que dejaron reporte. Si una tarea no aparece, casi siempre es la Mac apagada o bloqueada, o Chrome sin la extensión conectada.</p></section>' +
      '<section>' + tira + leyenda + '</section>' +
      '<section style="display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px">' + ROLES.map(function (r, i) {
        var e = est[i], s = SEM[e.sem], x = roles[r.k] || {}, px = proxima(r);
        var al = lista(x.alertas), pe = lista(x.pendientes);
        var lin = e.linea.slice(-10).reverse();
        var pasadas = lin.length ? '<p class="cond small mut" style="margin:16px 0 6px">ÚLTIMAS PASADAS</p><ul style="list-style:none;margin:0;padding:0;display:grid;gap:5px">' + lin.map(function (l) {
          var d = new Date(l.c ? l.c.ts : l.slot), c = !l.c ? '#E8604C' : !l.c.ok ? '#E8604C' : l.c.alertas ? '#F2A93B' : '#4FB8A8';
          var txt = !l.c ? 'No corrió (tocaba ' + hhmm(new Date(l.slot)) + ')' : (l.c.ok ? '' : 'Falló · ') + (l.c.enviados != null ? l.c.enviados + ' enviados · ' : '') + (l.c.resumen || 'Corrió');
          return '<li class="small" style="display:flex;gap:10px;align-items:baseline">' + dot(c, 8) + '<span class="cond mut" style="flex:none;width:86px">' + fdate(d) + ' ' + hhmm(d) + '</span><span class="soft" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(txt + (l.c && l.c.alertas ? ' — ' + l.c.alertas : '')) + '">' + esc(txt) + '</span></li>';
        }).join('') + '</ul>' : '';
        return '<article id="sem-' + r.k + '" class="card" style="border-left-color:' + s[0] + ';padding:20px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><h2 style="font-size:20px;display:flex;align-items:center;gap:10px">' + dot(s[0], 12) + r.n + '</h2><span class="cond small" style="color:' + s[0] + '">' + s[1] + '</span></div>' +
          '<p class="cond small mut" style="margin:4px 0 0">' + r.d + '</p>' +
          '<p class="cond small mut" style="margin:6px 0 0">Horario: ' + r.h.map(function (hm) { return hm[0] + ':' + ('0' + hm[1]).slice(-2); }).join(' · ') + ' (lun a vie)' + (px ? ' · próxima ' + (px.toDateString() === new Date().toDateString() ? 'hoy' : fdate(px)) + ' ' + hhmm(px) : '') + '</p>' +
          (x.resumen ? '<p style="margin:14px 0 0;line-height:1.5">' + esc(x.resumen) + '</p>' : '') +
          (al.length ? '<p class="cond small" style="margin:14px 0 4px;color:#E8604C">ALERTAS</p><ul class="soft small" style="margin:0;padding-left:18px;line-height:1.55">' + al.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
          (pe.length ? '<p class="cond small" style="margin:14px 0 4px;color:#F2A93B">PENDIENTES</p><ul class="soft small" style="margin:0;padding-left:18px;line-height:1.55">' + pe.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
          pasadas + '</article>';
      }).join('') + '</section>';
  }

  function exportar() {
    var rows = filtrarContactos();
    var data = rows.map(function (c) { return { Nombre: c.nombre, Empresa: c.empresa, Cargo: c.cargo, Mail: c.mail, WhatsApp: c.wpp, LinkedIn: c.linkedin, Rubro: c.rubro, Campaña: c.campana, Etapa: c.etapa, 'Último movimiento': c.ultimo ? c.ultimo.toISOString().slice(0, 10) : '' }; });
    var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Contactos');
    XLSX.writeFile(wb, 'Enfoco contactos ' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }

  // ---------- eventos ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-seg],[data-camp],[data-ptab],[data-apr]');
    if (!t) return;
    if (t.dataset.seg) { sumarSeguimiento(t.dataset.seg); return; }
    if (t.dataset.apr) { decidir(t.dataset.apr, t.dataset.id); return; }
    if (t.dataset.ptab) { S.presTab = t.dataset.ptab; render(); return; }
    if (t.dataset.camp) { S.filtro = { q: '', etapa: '', camp: t.dataset.camp }; return; }
    var a = t.dataset.act;
    if (a === 'login') login();
    else if (a === 'salir') salir();
    else if (a === 'reconectar') reconectarDrive();
    else if (a === 'recargar') cargar();
    else if (a === 'exportar') exportar();
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-registrar]');
    if (!f) return;
    e.preventDefault();
    registrar(f.dataset.registrar, f);
  });
  var deb;
  function rerenderInput(id, setter) {
    return function (e) {
      if (e.target.id !== id) return;
      setter(e.target.value); clearTimeout(deb);
      deb = setTimeout(function () { var pos = e.target.selectionStart; render(); var i = document.getElementById(id); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 300);
    };
  }
  document.addEventListener('input', rerenderInput('fq', function (v) { S.filtro.q = v; }));
  document.addEventListener('input', rerenderInput('qp', function (v) { S.qPres = v; }));
  document.addEventListener('change', function (e) {
    if (e.target.id === 'fe') { S.filtro.etapa = e.target.value; render(); }
    if (e.target.id === 'fc') { S.filtro.camp = e.target.value; render(); }
  });
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
})();
