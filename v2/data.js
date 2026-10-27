// Lectura y armado de datos. Funciones puras: se pueden probar fuera del navegador.
(function (root) {
  'use strict';

  var DAY = 86400000;

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\(.*?\)/g, ' ')
      .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|sa|srl|inc|ltd|group|grupo)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function slug(s) { return norm(s).replace(/ /g, '-').slice(0, 80) || 'x'; }

  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!/\d/.test(s) || /[a-z]{3,}/i.test(s.replace(/usd|ars|us\$/ig, ''))) return null;
    s = s.replace(/[^\d.,-]/g, '');
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') {
      if (v > 1e11) return new Date(v);
      if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * DAY) + 12 * 3600000);
      return null;
    }
    var s = String(v).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], 12);
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1], 12); }
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY); }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  function sheetRows(wb, name) {
    var ws = wb.Sheets[name];
    if (!ws) {
      var alt = wb.SheetNames.filter(function (n) { return norm(n) === norm(name); })[0];
      ws = alt && wb.Sheets[alt];
    }
    if (!ws) return null;
    return root.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  }

  function findHeader(rows, mustHave) {
    for (var i = 0; i < Math.min(rows.length, 15); i++) {
      var r = (rows[i] || []).map(function (c) { return norm(c); });
      if (mustHave.every(function (h) { return r.some(function (c) { return c.indexOf(h) === 0; }); })) return i;
    }
    return -1;
  }
  function col(header, startsWith, from) {
    for (var i = from || 0; i < header.length; i++) if (norm(header[i]).indexOf(startsWith) === 0) return i;
    return -1;
  }

  // --- Etapas -------------------------------------------------------------
  // Orden de avance. Lo que está a la derecha pesa más.
  var ORDEN = ['Rebotado', 'Sin respuesta', 'Contactado', 'Perdido', 'En pausa', 'Respondió', 'Reunión', 'Presupuesto', 'Ganado'];
  function rank(e) { var i = ORDEN.indexOf(e); return i < 0 ? 2 : i; }

  // Traduce cualquier estado que escriban las tareas o los chats a una etapa.
  function etapaDeEstado(raw, fuente) {
    var s = norm(raw).replace(/ /g, '_');
    if (!s) return fuente === 'pipeline' ? 'Respondió' : 'Contactado';
    if (/reunion/.test(s)) return 'Reunión';
    if (/caliente|presupuest/.test(s)) return 'Presupuesto';
    if (/ganado|cliente|aprobad/.test(s)) return 'Ganado';
    if (/tibio|respond|derivado|interes/.test(s)) return 'Respondió';
    if (/estacionad|pausa|pospuest/.test(s)) return 'En pausa';
    if (/perdid|descartad|no_interes|rechaz/.test(s)) return 'Perdido';
    if (/muert/.test(s)) return 'Sin respuesta';
    if (/rebot|sin_whatsapp|invalid/.test(s)) return 'Rebotado';
    if (s === 'contactado' && fuente === 'pipeline') return 'Respondió';
    return 'Contactado';
  }
  // Estado que se escribe en la base cuando Dami cambia la etapa desde la ficha.
  var ESTADO_RAW = {
    outreach: { 'Respondió': 'respondio', 'Reunión': 'reunion', 'En pausa': 'estacionado', 'Perdido': 'descartado' },
    pipeline: { 'Respondió': 'contactado', 'Reunión': 'reunion_agendada', 'En pausa': 'contactado', 'Perdido': 'perdido' }
  };

  // --- Presupuestos -------------------------------------------------------
  var ESTADOS = {
    1: { label: 'Nuevo', color: '#4FB8A8' },
    2: { label: 'Enviado', color: '#F2A93B' },
    3: { label: 'En pausa', color: '#8C90CF' },
    4: { label: 'Aprobado', color: '#E6E8EF' },
    5: { label: 'Rechazado', color: '#7D8299' }
  };

  function splitLinks(s) {
    return String(s || '').split(/[\s|,]+/).filter(function (x) { return /^https?:\/\//.test(x); });
  }

  function parsePresupuestos(wb, hoy, tab, anio) {
    tab = tab || 'Presupuesto 2026';
    var rows = sheetRows(wb, tab);
    if (!rows) { if (anio) return []; throw new Error('No encontré la pestaña "' + tab + '"'); }
    var h = findHeader(rows, ['empresa', 'estado']);
    if (h < 0) return [];
    var H = rows[h];
    var c = {
      empresa: col(H, 'empresa'), trabajo: col(H, 'nombre del contacto'), ars: col(H, 'monto'),
      estado: col(H, 'estado'), envio: col(H, 'fecha de env'), prox: col(H, 'proxima accion'),
      paso: col(H, 'proximo paso'), link: col(H, 'presupuestos'), obs: col(H, 'observaciones')
    };
    if (c.prox < 0 && c.envio >= 0) c.prox = c.envio + 1;
    // La columna al lado del monto: en 2026 es USD o el canal (MAIL / WPP); en 2025 ya es Estado.
    var hNext = norm(H[c.ars + 1]);
    var hayCol2 = c.ars + 1 !== c.estado && (!hNext || /usd/.test(hNext) || /usd/.test(norm(H[c.ars])));
    var out = [], seen = {};
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r[c.empresa]) continue;
      var empresa = String(r[c.empresa]).trim();
      var trabajo = r[c.trabajo] ? String(r[c.trabajo]).trim() : '';
      var estadoTxt = r[c.estado] ? String(r[c.estado]).trim() : '';
      var num = parseInt(estadoTxt, 10) || 0;
      var usd = null, canal = '';
      if (hayCol2) {
        var d = r[c.ars + 1];
        usd = parseMoney(d);
        if (usd == null && d) canal = String(d).trim();
      }
      var envio = parseDate(r[c.envio]), prox = parseDate(r[c.prox]);
      var id = slug(empresa + ' ' + trabajo);
      if (anio) id = anio + '-' + id;
      if (seen[id]) id += '-' + i; seen[id] = 1;
      var label = (ESTADOS[num] || {}).label || estadoTxt || 'Sin estado';
      if (num === 3 && /sin respuesta/i.test(estadoTxt)) label = 'Sin respuesta';
      var linkTxt = c.link >= 0 && r[c.link] ? String(r[c.link]) : '';
      out.push({
        id: id, anio: anio || 2026, fila: i + 1, empresa: empresa, trabajo: trabajo,
        ars: parseMoney(r[c.ars]), usd: usd, canal: canal,
        estadoNum: num, estado: label, estadoColor: (ESTADOS[num] || {}).color || '#8A90A6',
        envio: envio, prox: prox,
        dias: envio ? daysBetween(envio, hoy) : null,
        abierto: num >= 1 && num <= 3,
        vencido: !!(prox && num >= 1 && num <= 3 && startOfDay(prox) < startOfDay(hoy)),
        paso: c.paso >= 0 && r[c.paso] ? String(r[c.paso]) : '',
        links: splitLinks(linkTxt), linkTxt: linkTxt,
        obs: c.obs >= 0 && r[c.obs] ? String(r[c.obs]) : '', docs: []
      });
    }
    return out;
  }

  // Vincula cada presupuesto con los archivos de la carpeta "Presupuestos 20xx" por nombre.
  var STOP = { presupuesto: 1, propuesta: 1, actualizado: 1, de: 1, la: 1, el: 1, los: 1, las: 1, y: 1, del: 1, en: 1, para: 1, con: 1, por: 1,
    compras: 1, argentina: 1, video: 1, videos: 1, foto: 1, fotos: 1, cobertura: 1, streaming: 1, podcast: 1, evento: 1, jornada: 1, docx: 1, pdf: 1 };
  function tokens(s) { return norm(s).split(' ').filter(function (w) { return w.length >= 3 && !STOP[w] && !/^\d+$/.test(w); }); }

  function matchDocs(presupuestos, files) {
    var fs = (files || []).map(function (f) { return { f: f, t: ' ' + norm(f.name) + ' ', mes: (String(f.name).match(/20\d\d_(\d{1,2})/) || [])[1] }; });
    presupuestos.forEach(function (p) {
      var te = tokens(p.empresa), tt = tokens(p.trabajo);
      if (!te.length) return;
      var mes = p.envio ? String(p.envio.getMonth() + 1) : null;
      var scored = fs.map(function (x) {
        var se = te.filter(function (w) { return x.t.indexOf(' ' + w + ' ') >= 0 || (w.length >= 5 && x.t.indexOf(w) >= 0); }).length;
        if (!se) return null;
        var st = tt.filter(function (w) { return x.t.indexOf(w) >= 0; }).length;
        var sm = mes && x.mes && +x.mes === +mes ? 1 : 0;
        return { f: x.f, s: se * 3 + st + sm };
      }).filter(Boolean).sort(function (a, b) { return b.s - a.s; });
      p.docs = scored.slice(0, 3).map(function (x) { return x.f; });
    });
  }

  // --- POSIBLES PROYECTOS (campaña ex clientes) ---------------------------
  function parsePosibles(wb) {
    var rows = sheetRows(wb, 'POSIBLES PROYECTOS');
    if (!rows) return [];
    var h = findHeader(rows, ['empresa', 'estado']);
    var H = rows[h];
    var pick = function (a, b) { var x = col(H, a); return x >= 0 ? x : col(H, b); };
    var c = { empresa: col(H, 'empresa'), propuesta: pick('propuesta', 'nombre del contacto'), medio: pick('medio', 'monto'),
      estado: col(H, 'estado'), envio: col(H, 'fecha de env'), paso: col(H, 'proximo paso'), obs: col(H, 'observaciones') };
    var out = [], grupo = '';
    var val = function (r, k) { return k >= 0 && r[k] != null && String(r[k]).trim() !== '' ? String(r[k]).trim() : ''; };
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r[c.empresa]) continue;
      var resto = r.filter(function (x, j) { return j !== c.empresa && x != null && String(x).trim() !== ''; }).length;
      if (!resto && /·|^[A-ZÁÉÍÓÚÑ0-9 ()\/-]{8,}$/.test(String(r[c.empresa]).trim())) { grupo = String(r[c.empresa]).trim(); continue; }
      var est = val(r, c.estado);
      var prop = val(r, c.propuesta);
      out.push({ empresa: String(r[c.empresa]).trim(), grupo: grupo, propuesta: prop === '?' ? '' : prop,
        responsable: val(r, c.medio), medio: val(r, c.medio), estadoNum: parseInt(est, 10) || 0, estado: est || 'Sin contactar',
        envio: parseDate(r[c.envio]), prox: parseDate(r[c.envio + 1]), paso: val(r, c.paso), canal: val(r, c.medio), obs: val(r, c.obs) });
    }
    return out;
  }

  // --- Ganancias y pérdidas -----------------------------------------------
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var ALIAS_CLIENTE = [
    [/abogados|cpacf|colegio publico/, 'Colegio de Abogados'], [/avicola|porcina|refrigeracion|red alimentaria|paola/, 'Red Alimentaria'],
    [/^gs ?1?\b|\bgs1\b/, 'GS1'], [/bedson/, 'Bedson'], [/ulloa/, 'Ulloa'], [/365/, '365Scores'], [/testear/, 'Testear.LA'],
    [/hospital italiano/, 'Hospital Italiano'], [/nutralia/, 'Nutralia'], [/\bmb\b|inofood/, 'MB'], [/aaec/, 'AAEC'], [/faca/, 'FACA'],
    [/montalto/, 'Grupo Montalto'], [/ceva/, 'CEVA'], [/affun/, 'AFFUN'], [/branca/, 'Branca'], [/pooled/, 'Pooled'], [/fiscales/, 'Fiscales']
  ];
  function clienteDe(desc) {
    var d = norm(desc).replace(/^ingresos? /, '').replace(/\b(usd|adelanto|restante|50|cuota|pago|cheque|transferencia)\b/g, ' ').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < ALIAS_CLIENTE.length; i++) if (ALIAS_CLIENTE[i][0].test(d)) return ALIAS_CLIENTE[i][1];
    var w = d.split(' ').filter(function (x) { return x.length > 2 && MESES.indexOf(x) < 0; }).slice(0, 2).join(' ');
    return w ? w.replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : 'Sin identificar';
  }

  // blue: { 'YYYY-MM': promedio venta }
  function parseFinanzas(wb, blue, anio) {
    anio = anio || 2026;
    blue = blue || {};
    var res = { meses: [], servicios: [], clientes: [], anio: anio };
    var rows = sheetRows(wb, 'Mensual');
    if (rows) {
      var h = findHeader(rows, ['pesos arg', 'mes']);
      var H = rows[h] || [];
      var ci = col(H, 'ingreso'), ce = col(H, 'egreso'), ct = col(H, 'total');
      var du = col(H, 'dolares');
      var ui = col(H, 'ingreso', du), ue = col(H, 'egreso', du), ut = col(H, 'total', du);
      for (var i = h + 1; i < rows.length && res.meses.length < 12; i++) {
        var r = rows[i] || [];
        var mes = r[ci - 1];
        if (!mes || /acumulado|total/i.test(mes)) break;
        var idx = MESES.indexOf(norm(mes));
        var key = anio + '-' + ('0' + (idx + 1)).slice(-2);
        var tasa = blue[key] || null;
        var m = { mes: String(mes), idx: idx, key: key, tasa: tasa,
          ars: { ing: +r[ci] || 0, egr: +r[ce] || 0, res: +r[ct] || 0 },
          usd: { ing: +r[ui] || 0, egr: +r[ue] || 0, res: +r[ut] || 0 } };
        m.activo = !!(m.ars.ing || m.ars.egr || m.usd.ing || m.usd.egr);
        if (tasa) {
          m.tot = { ing: m.ars.ing / tasa + m.usd.ing, egr: m.ars.egr / tasa + m.usd.egr };
          m.tot.res = m.tot.ing - m.tot.egr;
          m.porSocio = m.tot.res / 2;
        }
        res.meses.push(m);
      }
    }
    var f = sheetRows(wb, 'Facturación');
    if (f) {
      var fh = findHeader(f, ['servicio', 'ingreso']);
      var FH = f[fh] || [];
      var cm = col(FH, 'mes'), cs = col(FH, 'servicio'), cd = col(FH, 'descripcion'), cin = col(FH, 'ingreso');
      var fdu = col(FH, 'dolares'), cinu = col(FH, 'ingreso', fdu > 0 ? fdu : cin + 1);
      var acc = {}, cli = {};
      for (var j = fh + 1; j < f.length; j++) {
        var row = f[j] || [];
        var desc = String(row[cd] || '');
        if (/balance caja|cambio de caja|cambio de divisa|compra divisa/i.test(desc)) continue;
        var vi = parseMoney(row[cin]), vu = parseMoney(row[cinu]);
        if (!vi && !vu) continue;
        var mi = MESES.indexOf(norm(row[cm]));
        var tasaF = mi >= 0 ? blue[anio + '-' + ('0' + (mi + 1)).slice(-2)] : null;
        var usdEq = (vi && tasaF ? vi / tasaF : 0) + (vu || 0);
        var s = row[cs] ? String(row[cs]).trim() : 'Sin servicio';
        var a = acc[s] || (acc[s] = { servicio: s, ars: 0, usd: 0, usdEq: 0, n: 0 });
        a.ars += vi || 0; a.usd += vu || 0; a.usdEq += usdEq; a.n++;
        var cn = clienteDe(desc);
        var cc = cli[cn] || (cli[cn] = { cliente: cn, ars: 0, usd: 0, usdEq: 0, n: 0 });
        cc.ars += vi || 0; cc.usd += vu || 0; cc.usdEq += usdEq; cc.n++;
      }
      var arr = function (o) { return Object.keys(o).map(function (k) { return o[k]; }); };
      res.servicios = arr(acc).sort(function (a, b) { return (b.usdEq || b.ars) - (a.usdEq || a.ars); });
      res.clientes = arr(cli).sort(function (a, b) { return (b.usdEq || b.ars) - (a.usdEq || a.ars); });
    }
    var act = res.meses.filter(function (m) { return m.activo; });
    var sum = function (fn) { return act.reduce(function (s, m) { return s + (fn(m) || 0); }, 0); };
    res.totalArs = sum(function (m) { return m.ars.ing; });
    res.totalUsd = sum(function (m) { return m.usd.ing; });
    res.resultadoArs = sum(function (m) { return m.ars.res; });
    res.resultadoUsd = sum(function (m) { return m.usd.res; });
    var conTasa = act.filter(function (m) { return m.tot; });
    res.conTasa = conTasa.length === act.length && act.length > 0;
    if (conTasa.length) {
      res.usdTot = { ing: 0, egr: 0, res: 0 };
      conTasa.forEach(function (m) { res.usdTot.ing += m.tot.ing; res.usdTot.egr += m.tot.egr; res.usdTot.res += m.tot.res; });
      var n = conTasa.length;
      res.prom = { ing: res.usdTot.ing / n, egr: res.usdTot.egr / n, porSocio: res.usdTot.res / n / 2 };
    }
    return res;
  }

  // Promedio mensual del dólar blue (venta) desde la serie diaria de bluelytics.
  function blueMensual(serie) {
    var acc = {};
    (serie || []).forEach(function (x) {
      if (x.source && x.source !== 'Blue') return;
      var k = String(x.date).slice(0, 7), v = +x.value_sell;
      if (!v) return;
      var a = acc[k] || (acc[k] = [0, 0]); a[0] += v; a[1]++;
    });
    var out = {};
    Object.keys(acc).forEach(function (k) { out[k] = acc[k][0] / acc[k][1]; });
    return out;
  }

  // --- Firebase: pipeline y prospección -----------------------------------
  var CAMPANAS = [
    { id: 'vistage', nombre: 'Vistage', color: '#F2A93B', canales: 'LinkedIn, después WhatsApp o mail', firma: 'Damian Guelman',
      desc: 'Invitaciones de LinkedIn al directorio Vistage de Buenos Aires, un seguimiento a los 3 días si aceptaron, y la charla se muda a WhatsApp o mail cuando hay interés.',
      match: function (o) { return o.canal === 'linkedin'; } },
    { id: 'eventos', nombre: 'Congresos y Eventos', color: '#4FB8A8', canales: 'Mail y WhatsApp', firma: 'Dami',
      desc: 'Envío en frío a agencias de eventos, organizadores de congresos y agencias de comunicación de CABA y AMBA, ofreciendo streaming y cobertura para noviembre y diciembre.',
      match: function (o) { return o.canal === 'eventos'; } },
    { id: 'exclientes', nombre: 'Ex clientes', color: '#8C90CF', canales: 'WhatsApp y mail', firma: 'Dami o Seba',
      desc: 'Propuestas a clientes y ex clientes, trabajadas una por una desde la pestaña POSIBLES PROYECTOS. Cada mensaje sale con OK.' },
    { id: 'mail', nombre: 'Mail institucional', color: '#7D8299', canales: 'Mail', firma: 'Seba', historica: true,
      desc: 'Prospección por mail de 2026 (Cancillería y AMBA). Campaña cerrada, queda como base para futuras campañas.',
      match: function (o) { return !o.canal || o.canal === 'mail'; } }
  ];
  var RESPUESTA = { 'Respondió': 1, 'Reunión': 1, 'Presupuesto': 1, 'En pausa': 1, 'Ganado': 1, 'Perdido': 0 };

  function asArray(h) { return Array.isArray(h) ? h : (h && typeof h === 'object' ? Object.keys(h).map(function (k) { return h[k]; }) : []); }
  function histLead(h) {
    return asArray(h).filter(Boolean).map(function (x) {
      return { fecha: parseDate(x.fecha), quien: x.quien || '', tipo: x.tipo || '', texto: String(x.contenido || '') };
    });
  }
  function histOut(h) {
    return asArray(h).filter(Boolean).map(function (x) { return { fecha: parseDate(x.f), quien: '', tipo: '', texto: String(x.t || '') }; });
  }

  function buildModel(input) {
    var hoy = input.hoy || new Date();
    var leadsRaw = input.leads || {}, outRaw = input.outreach || {};
    var presupuestos = input.presupuestos || [], posibles = input.posibles || [];
    var seg = input.seguimientos || {};

    presupuestos.forEach(function (p) { var s = seg[p.id]; p.seguimientos = s ? Object.keys(s).length : 0; });

    var porEmpresa = {};
    presupuestos.forEach(function (p) {
      var k = norm(p.empresa).split(' ').slice(0, 2).join(' ');
      (porEmpresa[k] = porEmpresa[k] || []).push(p);
    });
    function presDe(empresa) {
      var k = norm(empresa).split(' ').slice(0, 2).join(' ');
      return k ? (porEmpresa[k] || []) : [];
    }

    var contactos = {}, list = [];
    function add(c) { contactos[c.key] = c; list.push(c); return c; }

    Object.keys(leadsRaw).forEach(function (id) {
      if (/^zz/.test(id) || id === 'estadoAsistente') return;
      var v = leadsRaw[id];
      if (!v || typeof v !== 'object' || !v.empresa && !v.contacto) return;
      if (v.estado === 'duplicado') return;
      add({ key: 'L-' + id, fuente: 'pipeline', leadId: id, nombre: v.contacto || '', empresa: v.empresa || '', cargo: v.cargo || '',
        mail: v.mail || '', wpp: v.wpp || '', linkedin: v.linkedin || '', rubro: v.rubro || '', origen: v.origen || '', medio: v.medio || '',
        estadoRaw: v.estado || '', etapaBase: etapaDeEstado(v.estado || v.temp, 'pipeline'), clienteActivo: v.origen === 'cliente',
        proxFecha: parseDate(v.proxFecha), proxPaso: v.proxPaso || '', resumen: v.resumen || '',
        temp: v.temp || '', creado: parseDate(v.creadoEn), campanas: [], historial: histLead(v.historial) });
    });

    var dedupe = {};
    list.forEach(function (c) { dedupe[norm(c.empresa) + '|' + norm(c.nombre)] = c; });

    Object.keys(outRaw).forEach(function (id) {
      var v = outRaw[id];
      if (!v || typeof v !== 'object') return;
      var camp = CAMPANAS.filter(function (k) { return k.match && k.match(v); })[0];
      var dk = norm(v.empresa) + '|' + norm(v.contacto);
      var target = (v.leadId && contactos['L-' + v.leadId]) || dedupe[dk];
      var reg = { id: id, campana: camp ? camp.id : 'mail', estado: v.estado || '', etapa: etapaDeEstado(v.estado, 'outreach'),
        fechaEnvio: parseDate(v.fechaEnvio), tanda: v.tanda || '', rubro: v.rubro || v.segmento || v.tipo || '',
        gancho: v.gancho || '', resumen: v.resumen || '', noContactar: !!v.noContactar, prox: parseDate(v.proxSeguimiento) };
      if (target) {
        target.campanas.push(reg);
        target.historial = target.historial.concat(histOut(v.historial));
        if (!target.rubro && reg.rubro) target.rubro = reg.rubro;
        if (rank(reg.etapa) > rank(target.etapaBase)) target.etapaBase = reg.etapa;
        return;
      }
      var c = add({ key: 'O-' + id, fuente: 'prospeccion', outId: id, nombre: v.contacto || '', empresa: v.empresa || '', cargo: v.cargo || '',
        mail: v.email || '', wpp: v.whatsapp || '', linkedin: v.linkedin || '', web: v.web || '', rubro: reg.rubro, origen: '', medio: '',
        estadoRaw: v.estado || '', etapaBase: reg.etapa, proxFecha: reg.prox, proxPaso: '', resumen: v.resumen || '', creado: parseDate(v.creadoEn),
        campanas: [reg], historial: histOut(v.historial) });
      dedupe[dk] = c;
    });

    list.forEach(function (c) {
      c.presupuestos = presDe(c.empresa);
      c.historial.forEach(function (h, i) { h.i = i; });
      c.historial.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0) || b.i - a.i; });
      c.ultimo = c.historial[0] && c.historial[0].fecha || c.creado;
      c.ultimoTexto = c.historial[0] ? c.historial[0].texto : '';
      c.etapa = etapaDe(c);
      c.campana = c.campanas[0] ? c.campanas[0].campana : (c.fuente === 'pipeline' ? 'pipeline' : '');
      c.importancia = rank(c.etapa) * 1e13 + (c.ultimo ? +c.ultimo : 0);
    });

    var campanas = CAMPANAS.map(function (k) {
      if (k.id === 'exclientes') return campanaExClientes(k, posibles);
      var regs = [], contactosCamp = [];
      list.forEach(function (c) { c.campanas.forEach(function (r) { if (r.campana === k.id) { regs.push(r); if (contactosCamp.indexOf(c) < 0) contactosCamp.push(c); } }); });
      var ids = {}; var reuniones = 0, presN = 0, ganados = 0, respondieron = 0, vistos = {};
      contactosCamp.forEach(function (c) {
        if (RESPUESTA[c.etapa] || c.etapa === 'Perdido' && c.campanas.some(function (r) { return /descart|perdid/.test(r.estado); })) respondieron++;
        if (rank(c.etapa) >= rank('Reunión')) reuniones++;
        c.presupuestos.forEach(function (p) { if (!vistos[p.id]) { vistos[p.id] = 1; presN++; if (p.estadoNum === 4) ganados++; } });
      });
      var rub = {};
      contactosCamp.forEach(function (c) {
        var key = c.rubro || 'Sin rubro'; var x = rub[key] || (rub[key] = { rubro: key, n: 0, resp: 0 });
        x.n++; if (RESPUESTA[c.etapa]) x.resp++;
      });
      var semanas = [];
      for (var w = 7; w >= 0; w--) {
        var fin = new Date(startOfDay(hoy).getTime() - w * 7 * DAY + DAY), ini = new Date(fin.getTime() - 7 * DAY);
        semanas.push({ ini: ini, n: regs.filter(function (r) { return r.fechaEnvio && r.fechaEnvio >= ini && r.fechaEnvio < fin; }).length });
      }
      var ultimoEnvio = regs.reduce(function (m, r) { return r.fechaEnvio && r.fechaEnvio > m ? r.fechaEnvio : m; }, null);
      var ordenados = contactosCamp.slice().sort(function (a, b) { return b.importancia - a.importancia; });
      return Object.assign({}, k, {
        enviados: contactosCamp.length, respondieron: respondieron, reuniones: reuniones, presupuestos: presN, ganados: ganados,
        rebotados: contactosCamp.filter(function (c) { return c.etapa === 'Rebotado'; }).length,
        muertos: contactosCamp.filter(function (c) { return c.etapa === 'Sin respuesta'; }).length,
        rubros: Object.keys(rub).map(function (x) { return rub[x]; }).filter(function (x) { return x.n >= 3; })
          .sort(function (a, b) { return b.n - a.n; }).slice(0, 8),
        semanas: semanas, ultimoEnvio: ultimoEnvio, contactos: ordenados,
        importantes: ordenados.filter(function (c) { return rank(c.etapa) >= rank('Respondió'); })
      });
    });

    return { hoy: hoy, contactos: list, porKey: contactos, presupuestos: presupuestos, posibles: posibles, campanas: campanas };
  }

  function campanaExClientes(k, posibles) {
    var n = posibles.length;
    var enviados = posibles.filter(function (p) { return p.estadoNum >= 2; }).length;
    var aprob = posibles.filter(function (p) { return p.estadoNum === 4; }).length;
    var porEstado = {};
    posibles.forEach(function (p) { var e = p.estado || 'Sin estado'; porEstado[e] = (porEstado[e] || 0) + 1; });
    return Object.assign({}, k, { enviados: enviados, total: n, respondieron: null, reuniones: null,
      presupuestos: null, ganados: aprob, porEstado: porEstado, filas: posibles, rubros: [], semanas: [], contactos: [], importantes: [] });
  }

  function etapaDe(c) {
    var ps = (c.presupuestos || []).filter(function (p) { return p.anio === 2026; });
    if (ps.some(function (p) { return p.estadoNum === 4; })) return 'Ganado';
    if (ps.some(function (p) { return p.estadoNum === 1 || p.estadoNum === 2; })) return 'Presupuesto';
    var base = c.etapaBase || 'Contactado';
    if (ps.some(function (p) { return p.estadoNum === 3; }) && rank(base) < rank('Presupuesto')) return 'En pausa';
    if (ps.length && ps.every(function (p) { return p.estadoNum === 5; }) && rank(base) < rank('Reunión')) return 'Perdido';
    return base;
  }

  var api = { norm: norm, slug: slug, parseMoney: parseMoney, parseDate: parseDate, daysBetween: daysBetween, ymd: ymd,
    startOfDay: startOfDay, parsePresupuestos: parsePresupuestos, parsePosibles: parsePosibles, parseFinanzas: parseFinanzas,
    blueMensual: blueMensual, matchDocs: matchDocs, buildModel: buildModel, etapaDeEstado: etapaDeEstado, rank: rank,
    ESTADO_RAW: ESTADO_RAW, ORDEN: ORDEN, ESTADOS: ESTADOS, CAMPANAS: CAMPANAS };
  root.EnfocoData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
