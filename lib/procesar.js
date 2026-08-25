/* ===========================================================================
   procesar.js — ETL en el navegador (puerto JS de etl/build_data.py)
   Lee los CSV de cartera AFP, los clasifica con TAX y produce el mismo bundle
   que window.AFP_DATA. Funciona en navegador y en Node (para validación).
   =========================================================================== */
(function (global) {
  "use strict";
  const TAX = (typeof require !== "undefined") ? require("./taxonomia.js") : global.TAX;

  const MM = 1e6;
  const COL = { fecha:0, afp:1, fondo:2, tipo:3, nemo:4, emisor:5, unidades:8, inversion:10 };

  // ---- parser de línea (rápido con fallback consciente de comillas) ----
  function unquote(s) {
    if (s.length >= 2 && s.charCodeAt(0) === 34 && s.charCodeAt(s.length - 1) === 34)
      return s.slice(1, -1);
    return s;
  }
  function splitQuoted(line) {
    const out = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; cur += ch; }
      else if (ch === ';' && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function nuevoAcc() {
    return {
      serieCat:new Map(), serieFondo:new Map(), serieAlt:new Map(),
      serieSub:new Map(), serieReg:new Map(), serieGestor:new Map(),
      totalFecha:new Map(),
      maxMes:"", maxFecha:"",
      snap:new Map(), gestLat:new Map(), amSerie:new Map(), amDet:new Map(),
      instrAfp:new Map(), instrMeta:new Map(),
      expl:new Map(),
      corruptas:0, filas:0,
    };
  }
  const inc = (map, k, v) => map.set(k, (map.get(k) || 0) + v);

  function procesarTexto(text, acc) {
    let start = 0;
    const n = text.length;
    // saltar BOM
    if (text.charCodeAt(0) === 0xFEFF) start = 1;
    while (start < n) {
      let end = text.indexOf("\n", start);
      if (end === -1) end = n;
      let line = text.charAt(end - 1) === "\r" ? text.substring(start, end - 1) : text.substring(start, end);
      start = end + 1;
      if (!line) continue;
      if (line.charCodeAt(0) === 102 && line.indexOf("fecha;") === 0) continue; // header
      procesarLinea(line, acc);
    }
  }

  function procesarLinea(line, acc) {
    let p = line.split(";");
    if (p.length !== 18) p = splitQuoted(line);
    const fecha = unquote(p[COL.fecha] || "").trim();
    if (!/^\d{8}$/.test(fecha)) { acc.corruptas++; return; }
    if (p.length < 11) { acc.corruptas++; return; }
    acc.filas++;
    const afp = unquote(p[COL.afp]).trim().toLowerCase();
    const fondo = unquote(p[COL.fondo]).trim().toUpperCase();
    const tipo = unquote(p[COL.tipo]).trim().toUpperCase();
    const inv = parseFloat(unquote(p[COL.inversion])) || 0;
    const mes = fecha.slice(0, 4) + "-" + fecha.slice(4, 6);

    const t = TAX.clasificar(tipo);
    const cat = t.categoria, sub = t.subclase, region = t.region;
    const claseAlt = t.clase_alt || "";

    inc(acc.serieCat, mes + "|" + afp + "|" + cat, inv);
    inc(acc.serieFondo, mes + "|" + afp + "|" + fondo, inv);
    inc(acc.serieSub, mes + "|" + sub, inv);
    inc(acc.serieReg, mes + "|" + cat + "|" + region, inv);
    inc(acc.totalFecha, mes, inv);

    let gname = null, esLocal = false, esAmeris = false;
    if (t.es_alternativo) {
      inc(acc.serieAlt, mes + "|" + afp + "|" + t.clase_alt, inv);
      const emisor = unquote(p[COL.emisor]);
      const ce = TAX.clasificarEmisor(emisor);
      esLocal = ce[1]; esAmeris = ce[2];
      gname = ce[0] || (emisor.trim() ? TAX.titleCase(emisor.trim()).slice(0, 45) : "(sin emisor)");
      inc(acc.serieGestor, mes + "|" + gname, inv);
      if (esAmeris) inc(acc.amSerie, mes + "|" + afp, inv);
    }

    // detalle del snapshot (mes máximo) — reset al detectar mes mayor
    if (fecha > acc.maxFecha) {
      acc.maxFecha = fecha; acc.maxMes = mes;
      acc.snap.clear(); acc.gestLat.clear(); acc.amDet.clear();
      acc.instrAfp.clear(); acc.instrMeta.clear(); acc.expl.clear();
    }
    if (fecha === acc.maxFecha) {
      inc(acc.snap, afp+"|"+fondo+"|"+cat+"|"+sub+"|"+region+"|"+tipo+"|"+claseAlt, inv);
      // explorador: agrega también por emisor
      inc(acc.expl, afp+"|"+fondo+"|"+cat+"|"+sub+"|"+region+"|"+tipo+"|"+(unquote(p[COL.emisor] || "").trim()), inv);
      // instrumentos por nemotécnico × AFP
      const nemoI = unquote(p[COL.nemo] || "").trim();
      if (nemoI) {
        inc(acc.instrAfp, nemoI + "|" + afp, inv);
        if (!acc.instrMeta.has(nemoI)) acc.instrMeta.set(nemoI, [tipo, cat, unquote(p[COL.emisor] || "").trim()]);
      }
      if (t.es_alternativo) {
        inc(acc.gestLat, gname+"|"+(esLocal?1:0)+"|"+t.clase_alt+"|"+afp, inv);
        if (esAmeris) {
          const nemo = unquote(p[COL.nemo]).trim();
          const emisorRaw = unquote(p[COL.emisor]);
          const uni = parseFloat(unquote(p[COL.unidades])) || 0;
          const k = afp + "|" + nemo + "|" + emisorRaw;
          const cell = acc.amDet.get(k) || [0, 0];
          cell[0] += inv; cell[1] += uni; acc.amDet.set(k, cell);
        }
      }
    }
  }

  function finalizar(acc, fechaGen) {
    const mm = x => Math.round(x / MM * 100) / 100;
    // meses, afps, categorias ordenados (igual que Python)
    const meses = [...acc.totalFecha.keys()].sort();
    const afpsSet = new Set(), catsSet = new Set();
    for (const k of acc.serieCat.keys()) { const a = k.split("|"); afpsSet.add(a[1]); catsSet.add(a[2]); }
    const afps = [...afpsSet].sort();
    const cats = [...catsSet].sort();
    const mesIdx = new Map(meses.map((m, i) => [m, i]));
    const afpIdx = new Map(afps.map((a, i) => [a, i]));
    const catIdx = new Map(cats.map((c, i) => [c, i]));
    const mesUlt = acc.maxFecha.slice(0,4) + "-" + acc.maxFecha.slice(4,6);

    const SC = [], SF = [], SA = [], SS = [], SR = [], TMv = [];
    for (const [k, v] of acc.serieCat) { if (!v) continue; const a = k.split("|");
      SC.push([mesIdx.get(a[0]), afpIdx.get(a[1]), catIdx.get(a[2]), mm(v)]); }
    for (const [k, v] of acc.serieFondo) { if (!v) continue; const a = k.split("|");
      SF.push([mesIdx.get(a[0]), afpIdx.get(a[1]), a[2], mm(v)]); }
    for (const [k, v] of acc.serieAlt) { if (!v) continue; const a = k.split("|");
      SA.push([mesIdx.get(a[0]), afpIdx.get(a[1]), a.slice(2).join("|"), mm(v)]); }
    for (const [k, v] of acc.serieSub) { if (!v) continue; const i = k.indexOf("|");
      SS.push([mesIdx.get(k.slice(0,i)), k.slice(i+1), mm(v)]); }
    for (const [k, v] of acc.serieReg) { if (!v) continue; const a = k.split("|");
      SR.push([mesIdx.get(a[0]), a[1], a[2], mm(v)]); }
    for (const m of meses) TMv.push([mesIdx.get(m), mm(acc.totalFecha.get(m))]);

    const snap = [];
    for (const [k, v] of acc.snap) { if (!v) continue; const a = k.split("|");
      snap.push([a[0],a[1],a[2],a[3],a[4],a[5],a[6],mm(v)]); }
    const gl = [];
    for (const [k, v] of acc.gestLat) { if (!v) continue; const a = k.split("|");
      // gestor puede contener '|'? no lo contiene. clase_alt tampoco.
      gl.push([a[0], +a[1], a[2], a[3], mm(v)]); }

    // serie gestor: top 60 por último mes
    const totUlt = new Map();
    for (const [k, v] of acc.serieGestor) { const i = k.indexOf("|");
      if (k.slice(0,i) === mesUlt) inc(totUlt, k.slice(i+1), v); }
    const topGestores = [...totUlt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,60).map(e=>e[0]);
    const topSet = new Set(topGestores);
    const SG = [];
    for (const [k, v] of acc.serieGestor) { if (!v) continue; const i = k.indexOf("|");
      const g = k.slice(i+1); if (topSet.has(g)) SG.push([mesIdx.get(k.slice(0,i)), g, mm(v)]); }

    const amSerie = [];
    for (const [k, v] of acc.amSerie) { if (!v) continue; const a = k.split("|");
      amSerie.push([mesIdx.get(a[0]), afpIdx.get(a[1]), mm(v)]); }
    const amDet = [];
    for (const [k, c] of acc.amDet) { if (!c[0]) continue; const a = k.split("|");
      amDet.push([a[0], a[1], a.slice(2).join("|"), mm(c[0]), Math.round(c[1]*100)/100]); }

    // instrumentos por nemotécnico
    const instrTotal = new Map(), instrNafp = new Map();
    for (const [k, v] of acc.instrAfp) { if (!v) continue; const nemo = k.slice(0, k.lastIndexOf("|"));
      instrTotal.set(nemo, (instrTotal.get(nemo) || 0) + v); instrNafp.set(nemo, (instrNafp.get(nemo) || 0) + 1); }
    const nemosOrden = [...instrTotal.keys()].sort((a, b) => instrTotal.get(b) - instrTotal.get(a));
    const nemoIdx = new Map(nemosOrden.map((n, i) => [n, i]));
    const instrNemos = nemosOrden.map(n => { const me = acc.instrMeta.get(n) || ["", "", ""];
      return [n, me[0], me[1], me[2], mm(instrTotal.get(n)), instrNafp.get(n)]; });
    const instrData = [];
    for (const [k, v] of acc.instrAfp) { if (!v) continue; const i = k.lastIndexOf("|");
      instrData.push([nemoIdx.get(k.slice(0, i)), afpIdx.get(k.slice(i + 1)), mm(v)]); }

    // explorador (afp,fondo,cat,sub,region,tipo,emisor) con emisor indexado
    const emisSet = new Set();
    for (const k of acc.expl.keys()) emisSet.add(k.slice(k.lastIndexOf("|") + 1));
    const explEmis = [...emisSet].sort();
    const emisIdx = new Map(explEmis.map((e, i) => [e, i]));
    const explData = [];
    for (const [k, v] of acc.expl) { if (!v) continue; const i = k.lastIndexOf("|"); const a = k.slice(0, i).split("|");
      explData.push([afpIdx.get(a[0]), a[1], a[2], a[3], a[4], a[5], emisIdx.get(k.slice(i + 1)), mm(v)]); }

    const afpsNombre = {}; afps.forEach(a => afpsNombre[a] = TAX.AFP_NOMBRE[a] || a.toUpperCase());

    const meta = {
      generado: fechaGen, fuente: "Superintendencia de Pensiones - Base de Cartera de los Fondos de Pensiones",
      meses, mes_ultimo: mesUlt, fecha_ultima_raw: acc.maxFecha,
      afps: afpsNombre, afp_orden: afps, fondos: ["A","B","C","D","E"],
      categorias: cats, clases_alt: TAX.CLASES_ALT, unidad: "MM CLP (millones de pesos chilenos)",
      total_sistema_ultimo_MM: mm(acc.totalFecha.get(mesUlt) || 0),
      n_meses: meses.length, filas_corruptas_descartadas: acc.corruptas,
    };

    return {
      meta,
      serie_categoria:{cols:["mes","afp","cat","mm"], data:SC},
      serie_fondo:{cols:["mes","afp","fondo","mm"], data:SF},
      serie_alternativos:{cols:["mes","afp","clase","mm"], data:SA},
      serie_subclase:{cols:["mes","subclase","mm"], data:SS},
      serie_region:{cols:["mes","cat","region","mm"], data:SR},
      total_mes:{cols:["mes","mm"], data:TMv},
      snapshot:{mes:mesUlt, cols:["afp","fondo","cat","subclase","region","tipo","clase_alt","mm"], data:snap},
      gestores_latest:{mes:mesUlt, cols:["gestor","local","clase_alt","afp","mm"], data:gl},
      gestores_serie:{cols:["mes","gestor","mm"], data:SG, top:topGestores},
      ameris:{mes:mesUlt, serie:{cols:["mes","afp","mm"], data:amSerie},
              detalle:{cols:["afp","nemo","emisor","mm","unidades"], data:amDet}},
      instrumentos:{mes:mesUlt,
                    cols_nemos:["nemo","tipo","cat","emisor","total_mm","nafp"], nemos:instrNemos,
                    cols:["nemo_idx","afp","mm"], data:instrData},
      explorador:{mes:mesUlt, emisores:explEmis,
                  cols:["afp","fondo","cat","subclase","region","tipo","emis_idx","mm"], data:explData},
    };
  }

  // ---- orquestador navegador: procesa una lista de File ----
  async function procesarArchivos(fileList, onProgress) {
    const files = Array.from(fileList).filter(f => /\.csv$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!files.length) throw new Error("No se seleccionaron archivos .csv");
    const acc = nuevoAcc();
    for (let fi = 0; fi < files.length; fi++) {
      const f = files[fi];
      if (onProgress) onProgress({ etapa: "leyendo", archivo: f.name, fi, total: files.length, pct: fi / files.length });
      await procesarArchivoStream(f, acc, (p) => {
        if (onProgress) onProgress({ etapa: "procesando", archivo: f.name, fi, total: files.length,
          pct: (fi + p) / files.length });
      });
    }
    if (onProgress) onProgress({ etapa: "finalizando", pct: 0.99 });
    const hoy = new Date().toISOString().slice(0, 10);
    const bundle = finalizar(acc, hoy);
    if (onProgress) onProgress({ etapa: "listo", pct: 1, bundle });
    return bundle;
  }

  // lee un File por streaming (memoria acotada), conservando líneas partidas
  async function procesarArchivoStream(file, acc, onPct) {
    const size = file.size || 1;
    if (!file.stream) { // fallback
      const text = await file.text(); procesarTexto(text, acc); return;
    }
    const reader = file.stream().getReader();
    const dec = new TextDecoder("latin1");
    let resto = "", leido = 0, lastReport = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      leido += value.byteLength;
      let chunk = resto + dec.decode(value, { stream: true });
      const nl = chunk.lastIndexOf("\n");
      if (nl === -1) { resto = chunk; continue; }
      resto = chunk.slice(nl + 1);
      procesarTexto(chunk.slice(0, nl + 1), acc);
      if (onPct && leido - lastReport > 8e6) { lastReport = leido; onPct(leido / size); await new Promise(r => setTimeout(r)); }
    }
    if (resto) procesarTexto(resto + "\n", acc);
  }

  const P = { procesarArchivos, procesarTexto, nuevoAcc, finalizar };
  if (typeof module !== "undefined" && module.exports) module.exports = P;
  global.PROCESAR = P;
})(typeof self !== "undefined" ? self : this);
