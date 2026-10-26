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
    // "1.080.000" o "1,080,000" -> miles; "1.080.000,50" -> decimales con coma
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') {
      if (v > 1e11) return new Date(v);               // timestamp en ms
      if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * DAY) + 12 * 3600000); // serial de Excel
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

  // --- Presupuesto 2026 ---------------------------------------------------
  var ESTADOS = {
    1: { label: 'Por enviar', color: '#4FB8A8' },
    2: { label: 'Enviado', color: '#F2A93B' },
    3: { label: 'En pausa', color: '#8C90CF' },
    4: { label: 'Aprobado', color: '#E6E8EF' },
    5: { label: 'Rechazado', color: '#7D8299' }
  };

  function parsePresupuestos(wb, hoy) {
    var rows = sheetRows(wb, 'Presupuesto 2026');
    if (!rows) throw new Error('No encontré la pestaña "Presupuesto 2026"');
    var h = findHeader(rows, ['empresa', 'estado']);
    var H = rows[h];
    var c = {
      empresa: col(H, 'empresa'), trabajo: col(H, 'nombre del contacto'), ars: col(H, 'monto'),
      estado: col(H, 'estado'), envio: col(H, 'fecha de env'), prox: col(H, 'proxima accion'),
      paso: col(H, 'proximo paso'), link: col(H, 'presupuestos'), obs: col(H, 'observaciones')
    };
    var out = [], seen = {};
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r[c.empresa]) continue;
      var empresa = String(r[c.empresa]).trim();
      var trabajo = r[c.trabajo] ? String(r[c.trabajo]).trim() : '';
      var estadoTxt = r[c.estado] ? String(r[c.estado]).trim() : '';
      var num = parseInt(estadoTxt, 10) || 0;
      // La columna al lado de Monto ARS: si es número es USD, si es texto es el canal (MAIL / WPP)
      var d = r[c.ars + 1];
      var usd = parseMoney(d), canal = '';
      if (usd == null && d) canal = String(d).trim();
      var envio = parseDate(r[c.envio]), prox = parseDate(r[c.prox]);
      var id = slug(empresa + ' ' + trabajo);
      if (seen[id]) id += '-' + i; seen[id] = 1;
      var label = (ESTADOS[num] || {}).label || estadoTxt;
      if (num === 3 && /sin respuesta/i.test(estadoTxt)) label = 'Sin respuesta';
      out.push({
        id: id, fila: i + 1, empresa: empresa, trabajo: trabajo,
        ars: parseMoney(r[c.ars]), usd: usd, canal: canal,
        estadoNum: num, estado: label, estadoColor: (ESTADOS[num] || {}).color || '#8A90A6',
        envio: envio, prox: prox,
        dias: envio ? daysBetween(envio, hoy) : null,
        vencido: !!(prox && num >= 1 && num <= 3 && startOfDay(prox) < startOfDay(hoy)),
        paso: r[c.paso] ? String(r[c.paso]) : '', link: r[c.link] ? String(r[c.link]) : '',
        obs: r[c.obs] ? String(r[c.obs]) : ''
      });
    }
    return out;
  }

  // --- POSIBLES PROYECTOS (campaña ex clientes) ---------------------------
  function parsePosibles(wb, hoy) {
    var rows = sheetRows(wb, 'POSIBLES PROYECTOS');
    if (!rows) return [];
    var h = findHeader(rows, ['empresa', 'estado']);
    var H = rows[h];
    var c = { empresa: col(H, 'empresa'), propuesta: col(H, 'nombre del contacto'), resp: col(H, 'monto'),
      estado: col(H, 'estado'), envio: col(H, 'fecha de env'), paso: col(H, 'proximo paso'), obs: col(H, 'observaciones') };
    var out = [];
    for (var i = h + 1; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r[c.empresa]) continue;
      var est = r[c.estado] ? String(r[c.estado]).trim() : '';
      var envio = parseDate(r[c.envio]);
      var prox = parseDate(r[c.envio + 1]);
      out.push({ empresa: String(r[c.empresa]).trim(), propuesta: r[c.propuesta] ? String(r[c.propuesta]) : '',
        responsable: r[c.resp] ? String(r[c.resp]) : '', estadoNum: parseInt(est, 10) || 0, estado: est,
        envio: envio, prox: prox, canal: r[c.paso] ? String(r[c.paso]) : '', obs: r[c.obs] ? String(r[c.obs]) : '' });
    }
    return out;
  }

  // --- Ganancias y pérdidas -----------------------------------------------
  function parseFinanzas(wb) {
    var res = { meses: [], servicios: [], totalArs: null, totalUsd: null };
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
        res.meses.push({ mes: String(mes), ars: { ing: +r[ci] || 0, egr: +r[ce] || 0, res: +r[ct] || 0 },
          usd: { ing: +r[ui] || 0, egr: +r[ue] || 0, res: +r[ut] || 0 } });
      }
    }
    var f = sheetRows(wb, 'Facturación');
    if (f) {
      var fh = findHeader(f, ['servicio', 'ingreso']);
      var FH = f[fh] || [];
      var cs = col(FH, 'servicio'), cd = col(FH, 'descripcion'), cin = col(FH, 'ingreso');
      var fdu = col(FH, 'dolares'), cinu = col(FH, 'ingreso', fdu > 0 ? fdu : cin + 1);
      var acc = {};
      for (var j = fh + 1; j < f.length; j++) {
        var row = f[j] || [];
        var s = row[cs];
        if (!s) continue;
        if (/balance caja|cambio de caja/i.test(row[cd] || '')) continue;
        var key = String(s).trim();
        var a = acc[key] || (acc[key] = { servicio: key, ars: 0, usd: 0, n: 0 });
        var vi = parseMoney(row[cin]), vu = parseMoney(row[cinu]);
        if (vi) { a.ars += vi; a.n++; }
        if (vu) { a.usd += vu; if (!vi) a.n++; }
      }
      res.servicios = Object.keys(acc).map(function (k) { return acc[k]; })
        .filter(function (a) { return a.ars > 0 || a.usd > 0; })
        .sort(function (a, b) { return b.ars - a.ars; });
    }
    res.totalArs = res.meses.reduce(function (s, m) { return s + m.ars.ing; }, 0);
    res.totalUsd = res.meses.reduce(function (s, m) { return s + m.usd.ing; }, 0);
    res.resultadoArs = res.meses.reduce(function (s, m) { return s + m.ars.res; }, 0);
    res.resultadoUsd = res.meses.reduce(function (s, m) { return s + m.usd.res; }, 0);
    return res;
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

  var RESPONDIO = { respondio: 1, derivado_pipeline: 1 };

  function histLead(h) {
    var arr = Array.isArray(h) ? h : (h ? Object.keys(h).map(function (k) { return h[k]; }) : []);
    return arr.filter(Boolean).map(function (x) {
      return { fecha: parseDate(x.fecha), quien: x.quien || '', tipo: x.tipo || '', texto: String(x.contenido || '') };
    });
  }
  function histOut(h) {
    var arr = Array.isArray(h) ? h : (h ? Object.keys(h).map(function (k) { return h[k]; }) : []);
    return arr.filter(Boolean).map(function (x) { return { fecha: parseDate(x.f), quien: '', tipo: '', texto: String(x.t || '') }; });
  }

  function buildModel(input) {
    var hoy = input.hoy || new Date();
    var leadsRaw = input.leads || {}, outRaw = input.outreach || {};
    var presupuestos = input.presupuestos || [], posibles = input.posibles || [];
    var seg = input.seguimientos || {};

    presupuestos.forEach(function (p) {
      var s = seg[p.id];
      p.seguimientos = s ? Object.keys(s).length : 0;
    });

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
      add({ key: 'L-' + id, fuente: 'pipeline', leadId: id, nombre: v.contacto || '', empresa: v.empresa || '', cargo: v.cargo || '',
        mail: v.mail || '', wpp: v.wpp || '', linkedin: v.linkedin || '', rubro: v.rubro || '', origen: v.origen || '', medio: v.medio || '',
        estadoRaw: v.estado || '', proxFecha: parseDate(v.proxFecha), proxPaso: v.proxPaso || '', resumen: v.resumen || '',
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
      var reg = { id: id, campana: camp ? camp.id : 'mail', estado: v.estado || '', fechaEnvio: parseDate(v.fechaEnvio),
        tanda: v.tanda || '', rubro: v.rubro || v.segmento || v.tipo || '', gancho: v.gancho || '', resumen: v.resumen || '',
        noContactar: !!v.noContactar };
      if (target) {
        target.campanas.push(reg);
        target.historial = target.historial.concat(histOut(v.historial));
        if (!target.rubro && reg.rubro) target.rubro = reg.rubro;
        return;
      }
      var c = add({ key: 'O-' + id, fuente: 'prospeccion', nombre: v.contacto || '', empresa: v.empresa || '', cargo: v.cargo || '',
        mail: v.email || '', wpp: v.whatsapp || '', linkedin: v.linkedin || '', web: v.web || '', rubro: reg.rubro, origen: '', medio: '',
        estadoRaw: '', proxFecha: parseDate(v.proxSeguimiento), proxPaso: '', resumen: v.resumen || '', creado: parseDate(v.creadoEn),
        campanas: [reg], historial: histOut(v.historial) });
      dedupe[dk] = c;
    });

    list.forEach(function (c) {
      c.presupuestos = presDe(c.empresa);
      c.historial.sort(function (a, b) { return (b.fecha || 0) - (a.fecha || 0); });
      c.ultimo = c.historial[0] && c.historial[0].fecha || c.creado;
      c.etapa = etapaDe(c);
      c.campana = c.campanas[0] ? c.campanas[0].campana : (c.fuente === 'pipeline' ? 'pipeline' : '');
    });

    var campanas = CAMPANAS.map(function (k) {
      if (k.id === 'exclientes') return campanaExClientes(k, posibles, presupuestos);
      var regs = [], contactosCamp = [];
      list.forEach(function (c) { c.campanas.forEach(function (r) { if (r.campana === k.id) { regs.push(r); contactosCamp.push(c); } }); });
      var resp = regs.filter(function (r) { return RESPONDIO[r.estado]; }).length;
      var ids = {}; var reuniones = 0, presN = 0, ganados = 0, empresasPres = {};
      contactosCamp.forEach(function (c) {
        if (ids[c.key]) return; ids[c.key] = 1;
        if (c.etapa === 'Reunión') reuniones++;
        c.presupuestos.forEach(function (p) { if (!empresasPres[p.id]) { empresasPres[p.id] = 1; presN++; if (p.estadoNum === 4) ganados++; } });
      });
      var rub = {};
      regs.forEach(function (r) { var key = r.rubro || 'Sin rubro'; var x = rub[key] || (rub[key] = { rubro: key, n: 0, resp: 0 }); x.n++; if (RESPONDIO[r.estado]) x.resp++; });
      var semanas = [];
      for (var w = 7; w >= 0; w--) {
        var fin = new Date(startOfDay(hoy).getTime() - w * 7 * DAY + DAY), ini = new Date(fin.getTime() - 7 * DAY);
        semanas.push({ ini: ini, n: regs.filter(function (r) { return r.fechaEnvio && r.fechaEnvio >= ini && r.fechaEnvio < fin; }).length });
      }
      var ultimoEnvio = regs.reduce(function (m, r) { return r.fechaEnvio && r.fechaEnvio > m ? r.fechaEnvio : m; }, null);
      return Object.assign({}, k, {
        enviados: regs.length, respondieron: resp, reuniones: reuniones, presupuestos: presN, ganados: ganados,
        rebotados: regs.filter(function (r) { return r.estado === 'rebotado'; }).length,
        muertos: regs.filter(function (r) { return r.estado === 'muerto'; }).length,
        rubros: Object.keys(rub).map(function (x) { return rub[x]; }).filter(function (x) { return x.n >= 3; })
          .sort(function (a, b) { return b.n - a.n; }).slice(0, 8),
        semanas: semanas, ultimoEnvio: ultimoEnvio,
        contactos: contactosCamp.filter(function (c, i, arr) { return arr.indexOf(c) === i; })
      });
    });

    return { hoy: hoy, contactos: list, porKey: contactos, presupuestos: presupuestos, posibles: posibles, campanas: campanas };
  }

  function campanaExClientes(k, posibles, presupuestos) {
    var n = posibles.length;
    var enviados = posibles.filter(function (p) { return p.estadoNum >= 2; }).length;
    var aprob = posibles.filter(function (p) { return p.estadoNum === 4; }).length;
    var porEstado = {};
    posibles.forEach(function (p) { var e = p.estado || 'Sin estado'; porEstado[e] = (porEstado[e] || 0) + 1; });
    return Object.assign({}, k, { enviados: enviados, total: n, respondieron: null, reuniones: null,
      presupuestos: null, ganados: aprob, porEstado: porEstado, filas: posibles, rubros: [], semanas: [], contactos: [] });
  }

  function etapaDe(c) {
    var ps = c.presupuestos || [];
    if (ps.some(function (p) { return p.estadoNum === 4; })) return 'Ganado';
    if (ps.some(function (p) { return p.estadoNum === 1 || p.estadoNum === 2; })) return 'Presupuesto';
    if (ps.some(function (p) { return p.estadoNum === 3; })) return 'En pausa';
    if (ps.length && ps.every(function (p) { return p.estadoNum === 5; })) return 'Perdido';
    if (c.estadoRaw === 'reunion_agendada') return 'Reunión';
    if (c.estadoRaw === 'perdido') return 'Perdido';
    if (c.fuente === 'pipeline') return 'Respondió';
    var est = c.campanas.map(function (r) { return r.estado; });
    if (est.some(function (e) { return RESPONDIO[e]; })) return 'Respondió';
    if (est.indexOf('rebotado') >= 0) return 'Rebotado';
    if (est.length && est.every(function (e) { return e === 'muerto'; })) return 'Sin respuesta';
    return 'Contactado';
  }

  var api = { norm: norm, slug: slug, parseMoney: parseMoney, parseDate: parseDate, daysBetween: daysBetween,
    startOfDay: startOfDay, parsePresupuestos: parsePresupuestos, parsePosibles: parsePosibles, parseFinanzas: parseFinanzas,
    buildModel: buildModel, ESTADOS: ESTADOS, CAMPANAS: CAMPANAS };
  root.EnfocoData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
