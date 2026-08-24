/* ===========================================================================
   Dashboard Carteras AFP — Ameris AGF   |   app.js
   Fuente de datos: IndexedDB (si hay carga previa) -> window.AFP_DATA (datos.js).
   Permite recargar datos desde los CSV directamente en el navegador.
   =========================================================================== */
"use strict";

/* ---------------- Estado global de datos (se llena en initData) ---------------- */
let D, M, MESES, LAST, AFPS, CATS, CLASES_ALT;
let SC, SF, SA, SS, SR, TM, SNAP, GL, GS, AM, INSTR, instrByNemo, instrRows;
let PUB = false;   // true = build público (sin la lectura comercial de Ameris)
let totalByMonth, totalLatest, afpTotalLatest, afpCatLatest, catSystemLatest;
let afpAltLatest, altClaseLatest, afpAltClaseLatest, altSystemLatest, altPenSystem;

const afpName = c => (M.afps[c] || c.toUpperCase());
const afpNameByIdx = i => afpName(AFPS[i]);

/* ---------------- Moneda ---------------- */
let CUR = { mode: "CLP", rate: 1000 };   // 1 USD ≈ 1.000 CLP (editable). Valores base en MM CLP.
const cv = v => CUR.mode === "USD" ? v / CUR.rate : v;
const uniLbl = () => CUR.mode === "USD" ? "MM USD" : "MM CLP";

/* ---------------- Paleta de marca Ameris (hex exactos del sitio) ---------------- */
const C_BLUE = "#004cdc", C_CYAN = "#33bffd", C_TEAL = "#16b3a8", C_TEAL_L = "#59dbd6";
const CAT_COLORS = {
  "Renta Fija": C_BLUE, "Renta Variable": C_CYAN, "Fondos Mutuos": "#7a5ea8",
  "Alternativos": C_TEAL, "Derivados": "#9aa7b5", "Caja y otros": "#c2ccd6"
};
const ALT_COLORS = {
  "Capital Privado": C_BLUE, "Deuda Privada": "#1f6fe0", "Infraestructura": C_CYAN,
  "Inmobiliario / Real Estate": C_TEAL_L, "Fondos de Inversión Nacionales": "#0e9c8a",
  "Fondos de Inversión Extranjeros": "#8ad9d0"
};
const AFP_COLORS = ["#004cdc", "#33bffd", "#16b3a8", "#7a5ea8", "#e08a3c", "#d4574e", "#59dbd6", "#1f6fe0"];
const PALETTE = ["#004cdc", "#33bffd", "#16b3a8", "#7a5ea8", "#e08a3c", "#d4574e", "#59dbd6", "#6b7a8d", "#1f6fe0", "#0e9c8a", "#b5651d", "#c44e9d"];
const AMERIS = "#004cdc";        // resalte de Ameris en gráficos
const PEER = "#a9bad4";          // competidores (neutro)
const OK_GREEN = "#16b3a8", WARN = "#e08a3c"; // codificación de datos
const afpColor = i => AFP_COLORS[i % AFP_COLORS.length];
const catColor = c => CAT_COLORS[c] || "#9aa7b5";
const altColor = c => ALT_COLORS[c] || C_TEAL;

/* ---- Tipo de estrategia alternativa (para "qué ofrecer" a cada AFP) ---- */
const S_PE = "Capital privado", S_PD = "Deuda privada / Crédito", S_INF = "Infraestructura",
      S_RE = "Inmobiliario / Hipotecario", S_OTH = "Otros / diversificado";
const STRATS = [S_PE, S_PD, S_INF, S_RE, S_OTH];
const STRAT_COLORS = { [S_PE]: C_BLUE, [S_PD]: C_CYAN, [S_INF]: C_TEAL, [S_RE]: "#e08a3c", [S_OTH]: "#9aa7b5" };
const STRAT_SHORT = { [S_PE]: "Capital privado", [S_PD]: "Deuda", [S_INF]: "Infraestructura", [S_RE]: "Inmobiliario", [S_OTH]: "Otros" };

/* ---------------- Formato ---------------- */
const nf = (x, d = 0) => Number(x).toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtMM = v => nf(Math.round(cv(v))) + " MM";
function fmtBig(v) {
  const u = cv(v), a = Math.abs(u);
  if (CUR.mode === "USD") { if (a >= 1e3) return nf(u / 1e3, 1) + " B USD"; return nf(u, 0) + " MM USD"; }
  if (a >= 1e6) return nf(u / 1e6, 1) + " bill. CLP";
  if (a >= 1e3) return nf(u / 1e3, 1) + " mil MM CLP";
  return nf(u, 0) + " MM CLP";
}
function fmtAxis(v) {
  const u = cv(v), a = Math.abs(u);
  if (CUR.mode === "USD") { if (a >= 1e3) return nf(u / 1e3, 1) + " B"; return nf(u, 0); }
  if (a >= 1e6) return nf(u / 1e6, 1) + " bill";
  if (a >= 1e3) return nf(u / 1e3, 0) + " mil";
  return nf(u, 0);
}
const pct = (x, d = 1) => nf(x, d) + "%";

/* ---------------- Chart.js base ---------------- */
Chart.defaults.font.family = '"Open Sans","Segoe UI",Roboto,Helvetica,Arial,sans-serif';
Chart.defaults.color = "#5a6b80";
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.boxHeight = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.maintainAspectRatio = false;
const charts = {};
function mkChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), cfg);
  return charts[id];
}
// Valor robusto para tooltips: usa el dato crudo (número). En barras horizontales
// (indexAxis:"y") el valor está en parsed.x, no en parsed.y; con c.raw se evita esa confusión.
function tipValue(c) {
  if (typeof c.raw === "number") return c.raw;
  const ax = (c.chart && c.chart.options && c.chart.options.indexAxis === "y") ? "x" : "y";
  return (c.parsed && c.parsed[ax] != null) ? c.parsed[ax] : c.parsed;
}
const moneyTip = () => ({ callbacks: { label: c => ` ${c.dataset.label ? c.dataset.label + ": " : ""}${fmtMM(tipValue(c))}` } });
const axMoney = () => ({ ticks: { callback: fmtAxis }, title: { display: true, text: uniLbl() } });
const xTime = { ticks: { autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } };

/* ===========================================================================
   initData — calcula todos los agregados a partir de un bundle
   =========================================================================== */
function initData(bundle) {
  D = bundle; M = D.meta; MESES = M.meses; LAST = MESES.indexOf(M.mes_ultimo);
  AFPS = M.afp_orden; CATS = M.categorias; CLASES_ALT = M.clases_alt;
  SC = D.serie_categoria.data; SF = D.serie_fondo.data; SA = D.serie_alternativos.data;
  SS = D.serie_subclase.data; SR = D.serie_region.data; TM = D.total_mes.data;
  SNAP = D.snapshot.data; GL = D.gestores_latest.data; GS = D.gestores_serie.data;
  // MODO PÚBLICO: si el bundle no trae la sección "ameris" (build generado por
  // etl/publicar.js), el dashboard se arma sin la lectura comercial de Ameris.
  AM = D.ameris || null; PUB = !AM;
  INSTR = D.instrumentos || { nemos: [], data: [] };
  instrByNemo = {};
  (INSTR.data || []).forEach(([ni, ai, v]) => { (instrByNemo[ni] = instrByNemo[ni] || []).push([ai, v]); });
  instrRows = (INSTR.nemos || []).map((r, i) => ({
    i, nemo: r[0], tipo: r[1], cat: r[2], emisor: r[3], total: r[4], nafp: r[5],
    dec: decodeNemo(r[0], r[3]), mgr: mgrOf(r[3])
  }));

  totalByMonth = Array(MESES.length).fill(0); TM.forEach(([m, v]) => totalByMonth[m] = v);
  totalLatest = totalByMonth[LAST];
  afpTotalLatest = Array(AFPS.length).fill(0); afpCatLatest = {}; catSystemLatest = {};
  SC.forEach(([m, a, c, v]) => {
    if (m === LAST) {
      afpTotalLatest[a] += v; const cat = CATS[c];
      afpCatLatest[a + "|" + cat] = (afpCatLatest[a + "|" + cat] || 0) + v;
      catSystemLatest[cat] = (catSystemLatest[cat] || 0) + v;
    }
  });
  afpAltLatest = Array(AFPS.length).fill(0); altClaseLatest = {}; afpAltClaseLatest = {};
  SA.forEach(([m, a, cl, v]) => {
    if (m === LAST) {
      afpAltLatest[a] += v; altClaseLatest[cl] = (altClaseLatest[cl] || 0) + v;
      afpAltClaseLatest[a + "|" + cl] = (afpAltClaseLatest[a + "|" + cl] || 0) + v;
    }
  });
  altSystemLatest = Object.values(altClaseLatest).reduce((s, x) => s + x, 0);
  altPenSystem = 100 * altSystemLatest / totalLatest;
  rendered = {};
}

/* helpers de series */
function serieCatSistema(cat) { const a = Array(MESES.length).fill(0), ci = CATS.indexOf(cat);
  SC.forEach(([m, af, c, v]) => { if (c === ci) a[m] += v; }); return a; }
function serieAfpCat(afpIdx) { const out = {}; CATS.forEach(c => out[c] = Array(MESES.length).fill(0));
  SC.forEach(([m, a, c, v]) => { if (a === afpIdx) out[CATS[c]][m] += v; }); return out; }
function serieAfpTotal(afpIdx) { const a = Array(MESES.length).fill(0);
  SC.forEach(([m, af, c, v]) => { if (af === afpIdx) a[m] += v; }); return a; }
function serieAltClaseSistema() { const out = {}; CLASES_ALT.forEach(c => out[c] = Array(MESES.length).fill(0));
  SA.forEach(([m, a, cl, v]) => { if (out[cl]) out[cl][m] += v; }); return out; }
function serieAltTotalSistema() { const a = Array(MESES.length).fill(0); SA.forEach(([m, af, cl, v]) => a[m] += v); return a; }

/* ===========================================================================
   NAVEGACIÓN
   =========================================================================== */
const TABS = {
  resumen: { title: "Resumen del sistema", desc: "Visión global del patrimonio administrado por las AFP y su composición.", render: renderResumen },
  afp: { title: "Análisis por AFP", desc: "Perfil de inversión de cada Administradora de Fondos de Pensiones.", render: renderAfp },
  clases: { title: "Clases de activo", desc: "Comportamiento de cada clase de activo en el sistema AFP.", render: renderClases },
  alternativos: { title: "Activos alternativos", desc: "El universo donde compite Ameris AGF: tamaño, crecimiento y oportunidades.", render: renderAlt },
  gestores: { title: "Gestores / Competencia", desc: "Quién administra los activos alternativos de las AFP.", render: renderGestores },
  ameris: { title: "Posición Ameris", desc: "Posicionamiento de Ameris Capital AGF en la cartera de las AFP.", render: renderAmeris },
  instrumentos: { title: "Instrumentos / Fondos", desc: "Fondos por nemotécnico: dónde está Ameris, dónde hay oportunidad y qué AFP comparten cada fondo.", render: renderInstrumentos },
  explorador: { title: "Explorador de datos", desc: "Consulta libre de la cartera del último mes disponible.", render: renderExplorador },
};
let rendered = {}, currentTab = "resumen";

// En modo público se retiran del DOM la pestaña "Posición Ameris" y los bloques
// de lectura comercial, y se neutraliza el texto de las descripciones.
const TABS_DESC_PUB = {
  alternativos: "Tamaño, crecimiento y distribución del mercado de activos alternativos de las AFP.",
  instrumentos: "Fondos por nemotécnico: qué AFP invierte en cada uno y quiénes los comparten.",
};
function aplicarModoPublico() {
  if (!PUB) return;
  delete TABS.ameris;
  for (const k in TABS_DESC_PUB) if (TABS[k]) TABS[k].desc = TABS_DESC_PUB[k];
  ["[data-tab='ameris']", "#panel-ameris", "#instrConclTitle", "#instrConcl",
   "#chkInstrAmeris", "#gestAmerisHint"].forEach(sel => {
    const el = document.querySelector(sel); if (el) el.remove();
  });
  if (currentTab === "ameris") currentTab = "resumen";
}

function showTab(tab) {
  if (!TABS[tab]) tab = "resumen";
  currentTab = tab;
  document.querySelectorAll(".nav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.getElementById("panel-" + tab).classList.add("active");
  document.getElementById("pageTitle").textContent = TABS[tab].title;
  document.getElementById("pageDesc").textContent = TABS[tab].desc;
  renderExecSummary(tab);
  if (!rendered[tab]) { TABS[tab].render(); rendered[tab] = true; }
}

// Resumen ejecutivo ("qué mirar aquí") en la parte superior de cada pestaña
function renderExecSummary(tab) {
  const el = document.getElementById("execsum"); if (!el) return;
  const g12 = LAST >= 12 && totalByMonth[LAST - 12] ? 100 * (totalByMonth[LAST] / totalByMonth[LAST - 12] - 1) : null;
  let totAm = 0, nCli = 0, amRank = 0, amAbsent = [];
  if (AM) {
    const amSerie = Array(MESES.length).fill(0); AM.serie.data.forEach(([m, a, v]) => amSerie[m] += v);
    totAm = amSerie[LAST];
    const amByAfp = {}; AM.serie.data.forEach(([m, a, v]) => { if (m === LAST) amByAfp[a] = (amByAfp[a] || 0) + v; });
    nCli = Object.values(amByAfp).filter(v => v > 0).length;
    const localAgg = {}; GL.forEach(([gn, loc, cl, af, v]) => { if (loc) localAgg[gn] = (localAgg[gn] || 0) + v; });
    const localRank = Object.entries(localAgg).sort((a, b) => b[1] - a[1]);
    amRank = localRank.findIndex(x => x[0] === "Ameris") + 1;
    amAbsent = [...AFPS.keys()].filter(k => !amByAfp[k]).map(afpNameByIdx);
  }
  let s = "";
  if (PUB) {
    switch (tab) {
      case "resumen":
        s = `El sistema AFP administra <b>${fmtBig(totalLatest)}</b>${g12 != null ? ` (${g12 >= 0 ? "+" : ""}${pct(g12)} en 12 meses)` : ""}. Los <b>activos alternativos</b> pesan <b>${pct(altPenSystem)}</b> (${fmtBig(altSystemLatest)}). Abajo: la evolución del patrimonio y cómo se reparte por clase de activo y por AFP.`; break;
      case "afp":
        s = `Elige una AFP para ver su cartera, sus multifondos (A–E) y su evolución. La barra <b>“vs. exposición del sistema”</b> muestra si invierte en alternativos por sobre o por debajo del promedio. Más abajo, <b>“cartera alternativa por tipo de estrategia”</b> abre su cartera por tipo de fondo (deuda, inmobiliario, infraestructura, capital privado); haz clic en una estrategia para ver el <b>detalle fondo por fondo</b>.`; break;
      case "clases":
        s = `Elige una clase de activo y verás cuánto pesa en el sistema, si es <b>nacional o extranjera</b>, su evolución y qué AFP la prefieren.`; break;
      case "alternativos":
        s = `El mercado alternativo suma <b>${fmtBig(altSystemLatest)}</b> (<b>${pct(altPenSystem)}</b> del sistema). La matriz marca qué AFP están sub o sobre-invertidas frente a sus pares; más abajo, <b>“¿en qué tipo de fondos invierte cada AFP?”</b> abre la cartera por estrategia (deuda, inmobiliario, infraestructura, capital privado).`; break;
      case "gestores":
        s = `Ranking de administradoras en el mercado alternativo de las AFP. Cambia entre <b>AGF locales</b> y gestores globales. En la tabla, <b>a más color, más monto</b>: se ve al instante dónde está fuerte cada gestor y en qué AFP.`; break;
      case "instrumentos":
        s = `Busca un fondo por su <b>nombre o nemotécnico</b> y verás cuánto invierte cada AFP y quiénes lo comparten.`; break;
      case "explorador":
        s = `Consulta libre de <b>toda la cartera</b> del último mes. Filtra por AFP, categoría, multifondo u origen, busca un instrumento y <b>exporta a CSV</b> para tus análisis.`; break;
    }
    el.innerHTML = s ? `<span class="es-lbl">Qué mirar aquí</span>${s}` : "";
    return;
  }
  switch (tab) {
    case "resumen":
      s = `El sistema AFP administra <b>${fmtBig(totalLatest)}</b>${g12 != null ? ` (${g12 >= 0 ? "+" : ""}${pct(g12)} en 12 meses)` : ""}. Los <b>activos alternativos</b> —donde compite Ameris— pesan <b>${pct(altPenSystem)}</b> (${fmtBig(altSystemLatest)}). Abajo: la evolución del patrimonio y cómo se reparte por clase de activo y por AFP.`; break;
    case "afp":
      s = `Elige una AFP para ver su cartera, sus multifondos (A–E) y su evolución. El dato clave para Ameris es la barra <b>“vs. exposición del sistema”</b>: si invierte en alternativos <b>menos</b> que el promedio, hay espacio. Más abajo, <b>“cartera alternativa por tipo de estrategia”</b> muestra en qué tipos de fondo invierte (deuda, inmobiliario, infraestructura, capital privado); haz clic en una estrategia para ver el <b>detalle fondo por fondo</b>.`; break;
    case "clases":
      s = `Elige una clase de activo y verás cuánto pesa en el sistema, si es <b>nacional o extranjera</b>, su evolución y qué AFP la prefieren. La clase <b>Alternativos</b> es el foco comercial de Ameris.`; break;
    case "alternativos":
      s = `El mercado alternativo suma <b>${fmtBig(altSystemLatest)}</b> (<b>${pct(altPenSystem)}</b> del sistema). La <b>matriz de oportunidad</b> marca qué AFP están sub-invertidas frente a sus pares; más abajo, <b>“¿en qué tipo de fondos invierte cada AFP?”</b> abre la cartera por estrategia (deuda, inmobiliario, infraestructura, capital privado) y sugiere <b>qué producto ofrecerle a cada una</b>.`; break;
    case "gestores":
      s = `Ranking de administradoras en el mercado alternativo de las AFP.${amRank ? ` Ameris es <b>#${amRank}</b> entre las AGF locales.` : ""} Cambia entre <b>AGF locales</b> (competencia directa) y gestores globales. En la tabla, <b>a más color, más monto</b>: se ve al instante dónde está fuerte cada gestor y en qué AFP.`; break;
    case "ameris":
      s = `Ameris tiene <b>${fmtBig(totAm)}</b> colocados en <b>${nCli} de ${AFPS.length}</b> AFP${amRank ? ` (#${amRank} entre las AGF locales)` : ""}.${amAbsent.length ? ` Aún ausente en <b>${amAbsent.join(", ")}</b> → oportunidad de cross-sell.` : ""} El detalle fondo por fondo está en <b>Instrumentos / Fondos</b>.`; break;
    case "instrumentos":
      s = `Busca un fondo por su <b>nombre o nemotécnico</b> y verás cuánto invierte cada AFP y quiénes lo comparten. Arriba, <b>“Lecturas para Ameris”</b> resume dónde está Ameris, la competencia más adoptada y la mayor oportunidad.`; break;
    case "explorador":
      s = `Consulta libre de <b>toda la cartera</b> del último mes. Filtra por AFP, categoría, multifondo u origen, busca un instrumento y <b>exporta a CSV</b> para tus análisis.`; break;
  }
  el.innerHTML = s ? `<span class="es-lbl">Qué mirar aquí</span>${s}` : "";
}
document.getElementById("nav").addEventListener("click", e => {
  const b = e.target.closest("button"); if (b) showTab(b.dataset.tab);
});

const MES_ABR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function mesLbl(ym) { const [y, m] = ym.split("-"); return `${MES_ABR[+m - 1]}-${y}`; }
function initHeader() {
  document.getElementById("metaPill").innerHTML =
    `Último dato: <b>${mesLbl(M.mes_ultimo)}</b> &nbsp;·&nbsp; ${AFPS.length} AFP &nbsp;·&nbsp; Unidad: <b id="unitLbl">${uniLbl()}</b>`;
  document.getElementById("sidebarFoot").innerHTML =
    `Fuente: Superintendencia de Pensiones.<br>Datos ${MESES[0]} → ${M.mes_ultimo}.<br>Actualizado ${M.generado}.`;
}
function refreshUnitPill() { const e = document.getElementById("unitLbl"); if (e) e.textContent = uniLbl(); }

/* ===========================================================================
   KPI helper
   =========================================================================== */
function kpiCard(label, value, sub, cls = "") {
  return `<div class="kpi ${cls}"><div class="k-label">${label}</div>
    <div class="k-value">${value}</div><div class="k-sub">${sub || ""}</div></div>`;
}
function deltaHTML(curr, prev) {
  if (!prev) return "";
  const d = 100 * (curr / prev - 1), cls = d >= 0 ? "up" : "down", arrow = d >= 0 ? "▲" : "▼";
  return `<span class="k-delta ${cls}">${arrow} ${pct(Math.abs(d))}</span> 12m`;
}
// Variación mes a mes (m/m) y año a año (a/a) de una serie mensual indexada por mes.
function deltaMoMYoY(series, idx) {
  const cur = series[idx];
  const part = (prev, lbl) => {
    if (!prev) return "";
    const d = 100 * (cur / prev - 1), cls = d >= 0 ? "up" : "down", ar = d >= 0 ? "▲" : "▼";
    return `<span class="k-delta ${cls}">${ar} ${pct(Math.abs(d))}</span> ${lbl}`;
  };
  return [part(idx >= 1 ? series[idx - 1] : 0, "m/m"), part(idx >= 12 ? series[idx - 12] : 0, "a/a")]
    .filter(Boolean).join(" · ");
}

/* ===========================================================================
   TAB: RESUMEN
   =========================================================================== */
function renderResumen() {
  const prev12 = LAST >= 12 ? totalByMonth[LAST - 12] : 0;
  document.getElementById("kpiResumen").innerHTML =
    kpiCard("Patrimonio total del sistema", fmtBig(totalLatest), deltaMoMYoY(totalByMonth, LAST), "accent")
    + kpiCard("Activos alternativos", fmtBig(altSystemLatest), `${pct(altPenSystem)} de la cartera`, "accent")
    + kpiCard("Administradoras (AFP)", AFPS.length, "5 multifondos c/u (A–E)")
    + kpiCard("Renta fija + variable", pct(100 * ((catSystemLatest["Renta Fija"] || 0) + (catSystemLatest["Renta Variable"] || 0)) / totalLatest), "del patrimonio total");

  mkChart("chTotal", { type: "line", data: { labels: MESES, datasets: [{
    label: "Patrimonio total", data: totalByMonth, borderColor: C_BLUE,
    backgroundColor: "rgba(0,72,216,.10)", fill: true, tension: .25, pointRadius: 0, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: xTime, y: axMoney() } } });

  const cats = Object.keys(catSystemLatest).sort((a, b) => catSystemLatest[b] - catSystemLatest[a]);
  mkChart("chCompo", { type: "doughnut", data: { labels: cats, datasets: [{
    data: cats.map(c => catSystemLatest[c]), backgroundColor: cats.map(catColor), borderWidth: 2, borderColor: "#fff" }] },
    options: { cutout: "58%", plugins: { legend: { position: "right" }, tooltip: { callbacks: { label: c =>
      ` ${c.label}: ${fmtMM(c.parsed)} (${pct(100 * c.parsed / totalLatest)})` } } } } });

  const order = [...AFPS.keys()].sort((a, b) => afpTotalLatest[b] - afpTotalLatest[a]);
  mkChart("chPorAfp", { type: "bar", data: { labels: order.map(afpNameByIdx), datasets: [{
    label: "Patrimonio", data: order.map(i => afpTotalLatest[i]), backgroundColor: order.map(i => afpColor(i)) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: axMoney(), y: { grid: { display: false } } } } });

  const cats2 = CATS.slice().sort((a, b) => (catSystemLatest[b] || 0) - (catSystemLatest[a] || 0));
  const perMonthCat = {}; cats2.forEach(c => perMonthCat[c] = Array(MESES.length).fill(0));
  SC.forEach(([m, a, c, v]) => { perMonthCat[CATS[c]][m] += v; });
  const ds = cats2.map(c => ({ label: c, data: perMonthCat[c].map((v, m) => 100 * v / (totalByMonth[m] || 1)),
    backgroundColor: catColor(c) + "cc", borderColor: catColor(c), fill: true, pointRadius: 0, borderWidth: 1, tension: .2 }));
  mkChart("chCompoTime", { type: "line", data: { labels: MESES, datasets: ds },
    options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${pct(c.parsed.y)}` } } },
      scales: { x: xTime, y: { stacked: true, max: 100, ticks: { callback: v => v + "%" } } } } });
}

/* ===========================================================================
   TAB: POR AFP
   =========================================================================== */
function renderAfp() {
  const sel = document.getElementById("afpSel");
  sel.innerHTML = [...AFPS.keys()].sort((a, b) => afpTotalLatest[b] - afpTotalLatest[a])
    .map(i => `<option value="${i}">${afpNameByIdx(i)}</option>`).join("");
  sel.onchange = () => drawAfp(+sel.value);
  drawAfp(+sel.value);
}
function drawAfp(i) {
  const tot = afpTotalLatest[i], totSerie = serieAfpTotal(i);
  const prev12 = LAST >= 12 ? totSerie[LAST - 12] : 0;
  const sizeRank = [...AFPS.keys()].sort((a, b) => afpTotalLatest[b] - afpTotalLatest[a]).indexOf(i) + 1;
  const altPct = 100 * afpAltLatest[i] / tot;
  document.getElementById("kpiAfp").innerHTML =
    kpiCard("Patrimonio", fmtBig(tot), deltaMoMYoY(totSerie, LAST), "accent")
    + kpiCard("Cuota del sistema", pct(100 * tot / totalLatest), `#${sizeRank} de ${AFPS.length} por tamaño`)
    + kpiCard("Activos alternativos", fmtBig(afpAltLatest[i]), `${pct(altPct)} de su cartera`, "accent")
    + kpiCard("vs. exposición del sistema", (altPct >= altPenSystem ? "+" : "") + pct(altPct - altPenSystem, 1).replace("%", " pp"),
        `Sistema: ${pct(altPenSystem)}`, altPct >= altPenSystem ? "" : "spot");

  const cats = CATS.filter(c => afpCatLatest[i + "|" + c]).sort((a, b) => afpCatLatest[i + "|" + b] - afpCatLatest[i + "|" + a]);
  mkChart("chAfpCompo", { type: "doughnut", data: { labels: cats, datasets: [{
    data: cats.map(c => afpCatLatest[i + "|" + c]), backgroundColor: cats.map(catColor), borderWidth: 2, borderColor: "#fff" }] },
    options: { cutout: "58%", plugins: { legend: { position: "right" }, tooltip: { callbacks: { label: c =>
      ` ${c.label}: ${fmtMM(c.parsed)} (${pct(100 * c.parsed / tot)})` } } } } });

  const fondoMM = {}; ["A", "B", "C", "D", "E"].forEach(f => fondoMM[f] = 0);
  SF.forEach(([m, a, f, v]) => { if (m === LAST && a === i && fondoMM[f] !== undefined) fondoMM[f] += v; });
  mkChart("chAfpFondo", { type: "bar", data: { labels: Object.keys(fondoMM), datasets: [{
    label: "Patrimonio", data: Object.values(fondoMM), backgroundColor: ["#D4574E", "#E08A3C", "#54D8CC", "#2BB5F5", "#0048D8"] }] },
    options: { plugins: { legend: { display: false }, tooltip: moneyTip() },
      scales: { y: axMoney(), x: { grid: { display: false }, title: { display: true, text: "Multifondo (A=+riesgo · E=+conservador)" } } } } });

  const m = serieAfpCat(i);
  const cats3 = CATS.slice().sort((a, b) => (afpCatLatest[i + "|" + b] || 0) - (afpCatLatest[i + "|" + a] || 0));
  mkChart("chAfpTime", { type: "line", data: { labels: MESES, datasets: cats3.map(c => ({
    label: c, data: m[c], backgroundColor: catColor(c) + "cc", borderColor: catColor(c), fill: true, pointRadius: 0, borderWidth: 1, tension: .2 })) },
    options: { plugins: { legend: { position: "bottom" }, tooltip: moneyTip() }, scales: { x: xTime, y: Object.assign({ stacked: true }, axMoney()) } } });

  const catsAll = CATS.slice().sort((a, b) => (catSystemLatest[b] || 0) - (catSystemLatest[a] || 0));
  mkChart("chAfpVs", { type: "bar", data: { labels: catsAll, datasets: [
    { label: afpNameByIdx(i), data: catsAll.map(c => 100 * (afpCatLatest[i + "|" + c] || 0) / tot), backgroundColor: C_BLUE },
    { label: "Sistema", data: catsAll.map(c => 100 * (catSystemLatest[c] || 0) / totalLatest), backgroundColor: "#9aa7b5" }] },
    options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${pct(c.parsed.y)}` } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: v => v + "%" } } } } });

  drawAfpStrat(i);
}

// Cartera alternativa de UNA AFP, desglosada por tipo de estrategia, con detalle fondo por fondo (auditable).
let afpStratFilter = null;   // null = todas las estrategias
function drawAfpStrat(i) {
  const rows = [], byStrat = {};
  STRATS.forEach(s => byStrat[s] = { tot: 0, n: 0 });
  instrRows.forEach(r => {
    if (r.cat !== "Alternativos") return;
    const pair = (instrByNemo[r.i] || []).find(p => p[0] === i);
    if (!pair || !pair[1]) return;
    const s = stratOf(r);
    rows.push({ r, mm: pair[1], s });
    byStrat[s].tot += pair[1]; byStrat[s].n++;
  });
  const total = STRATS.reduce((a, s) => a + byStrat[s].tot, 0) || 1;
  const nameEl = document.getElementById("afpStratName");
  if (nameEl) nameEl.textContent = afpNameByIdx(i);
  if (afpStratFilter && !byStrat[afpStratFilter].tot) afpStratFilter = null;

  // Pills (métrica por estrategia + filtro del detalle)
  const pills = STRATS.filter(s => byStrat[s].tot > 0).sort((a, b) => byStrat[b].tot - byStrat[a].tot);
  let ph = `<button class="spill${afpStratFilter === null ? " on" : ""}" data-s="">Todas` +
    `<span>${fmtMM(total)} · ${rows.length} fondos</span></button>`;
  ph += pills.map(s => `<button class="spill${afpStratFilter === s ? " on" : ""}" data-s="${s}" style="--sc:${STRAT_COLORS[s]}">` +
    `<i class="sw" style="background:${STRAT_COLORS[s]}"></i>${STRAT_SHORT[s]}` +
    `<span>${fmtMM(byStrat[s].tot)} · ${pct(100 * byStrat[s].tot / total)} · ${byStrat[s].n} fondos</span></button>`).join("");
  const pillBox = document.getElementById("afpStratPills");
  pillBox.innerHTML = ph;
  pillBox.querySelectorAll(".spill").forEach(b => b.onclick = () => {
    afpStratFilter = b.dataset.s || null; drawAfpStrat(i);
  });

  // Tabla de detalle (auditoría): un fondo por fila
  let list = rows.sort((a, b) => a.s === b.s ? b.mm - a.mm : STRATS.indexOf(a.s) - STRATS.indexOf(b.s));
  if (afpStratFilter) list = list.filter(x => x.s === afpStratFilter);
  let h = `<thead><tr><th>Estrategia</th><th>Fondo</th><th>Nemotécnico</th><th>Instr.</th>` +
    `<th>Gestor</th><th class="num">Monto</th><th class="num">% alt.</th></tr></thead><tbody>`;
  if (!list.length) {
    h += `<tr><td colspan="7" class="empty">Esta AFP no tiene fondos alternativos en el último mes.</td></tr>`;
  } else list.forEach(x => {
    h += `<tr><td><span class="sg-tag" style="border-color:${STRAT_COLORS[x.s]}"><i class="sw" style="background:${STRAT_COLORS[x.s]}"></i>${STRAT_SHORT[x.s]}</span></td>` +
      `<td><b>${fundName(x.r)}</b></td>` +
      `<td><span class="nemo-code">${x.r.nemo || "·"}</span></td>` +
      `<td><span class="tipo-code" title="Código de instrumento (Anexo I)">${x.r.tipo || "·"}</span></td>` +
      `<td class="ex-emisor">${x.r.mgr.label || cleanName(x.r.emisor) || "·"}</td>` +
      `<td class="num">${fmtMM(x.mm)}</td>` +
      `<td class="num">${pct(100 * x.mm / total)}</td></tr>`;
  });
  document.getElementById("tblAfpStrat").innerHTML = h + "</tbody>";
}

/* ===========================================================================
   TAB: CLASES DE ACTIVO
   =========================================================================== */
function renderClases() {
  const sel = document.getElementById("catSel");
  sel.innerHTML = CATS.slice().sort((a, b) => (catSystemLatest[b] || 0) - (catSystemLatest[a] || 0))
    .map(c => `<option value="${c}">${c}</option>`).join("");
  sel.onchange = () => drawClase(sel.value);
  drawClase(sel.value);
}
function drawClase(cat) {
  const serie = serieCatSistema(cat);
  const tot = serie[LAST], prev12 = LAST >= 12 ? serie[LAST - 12] : 0;
  const sub = {}; let nac = 0, ext = 0;
  SNAP.forEach(r => { if (r[2] === cat) { sub[r[3]] = (sub[r[3]] || 0) + r[7]; if (r[4] === "Nacional") nac += r[7]; else ext += r[7]; } });
  document.getElementById("kpiClase").innerHTML =
    kpiCard("Monto en el sistema", fmtBig(tot), deltaHTML(tot, prev12), "accent")
    + kpiCard("Cuota del patrimonio", pct(100 * tot / totalLatest), "del total AFP")
    + kpiCard("Nacional", fmtBig(nac), pct(100 * nac / (nac + ext || 1)))
    + kpiCard("Extranjero", fmtBig(ext), pct(100 * ext / (nac + ext || 1)));

  const subK = Object.keys(sub).sort((a, b) => sub[b] - sub[a]);
  mkChart("chSub", { type: "bar", data: { labels: subK, datasets: [{ label: "Monto", data: subK.map(k => sub[k]),
    backgroundColor: subK.map((_, k) => PALETTE[k % PALETTE.length]) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: axMoney(), y: { grid: { display: false } } } } });

  const nacS = Array(MESES.length).fill(0), extS = Array(MESES.length).fill(0);
  SR.forEach(([m, c, reg, v]) => { if (c === cat) { if (reg === "Nacional") nacS[m] += v; else extS[m] += v; } });
  const totS = nacS.map((v, k) => v + extS[k] || 1);
  mkChart("chRegion", { type: "line", data: { labels: MESES, datasets: [
    { label: "Nacional", data: nacS.map((v, k) => 100 * v / totS[k]), backgroundColor: C_BLUE + "cc", borderColor: C_BLUE, fill: true, pointRadius: 0, borderWidth: 1 },
    { label: "Extranjero", data: extS.map((v, k) => 100 * v / totS[k]), backgroundColor: C_CYAN + "cc", borderColor: C_CYAN, fill: true, pointRadius: 0, borderWidth: 1 }] },
    options: { plugins: { legend: { position: "bottom" }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${pct(c.parsed.y)}` } } },
      scales: { x: xTime, y: { stacked: true, max: 100, ticks: { callback: v => v + "%" } } } } });

  mkChart("chCatTime", { type: "line", data: { labels: MESES, datasets: [{ label: cat, data: serie,
    borderColor: catColor(cat), backgroundColor: catColor(cat) + "22", fill: true, tension: .25, pointRadius: 0, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: xTime, y: axMoney() } } });

  const order = [...AFPS.keys()].sort((a, b) => (afpCatLatest[b + "|" + cat] || 0) / afpTotalLatest[b] - (afpCatLatest[a + "|" + cat] || 0) / afpTotalLatest[a]);
  mkChart("chCatAfp", { type: "bar", data: { labels: order.map(afpNameByIdx), datasets: [{ label: "% de cartera",
    data: order.map(i => 100 * (afpCatLatest[i + "|" + cat] || 0) / afpTotalLatest[i]), backgroundColor: catColor(cat) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${pct(c.parsed.x)} de la cartera` } } },
      scales: { x: { ticks: { callback: v => v + "%" } }, y: { grid: { display: false } } } } });
}

/* ===========================================================================
   TAB: ALTERNATIVOS
   =========================================================================== */
function renderAlt() {
  const altSerie = serieAltTotalSistema();
  const prev12 = LAST >= 12 ? altSerie[LAST - 12] : 0;
  const topClase = Object.keys(altClaseLatest).sort((a, b) => altClaseLatest[b] - altClaseLatest[a])[0];
  document.getElementById("kpiAlt").innerHTML =
    kpiCard("Activos alternativos (sistema)", fmtBig(altSystemLatest), deltaMoMYoY(altSerie, LAST), "accent")
    + kpiCard("Exposición media", pct(altPenSystem), "del patrimonio total", "accent")
    + kpiCard("Clase principal", topClase, fmtBig(altClaseLatest[topClase]))
    + kpiCard("Clases de activo", CLASES_ALT.length, "segmentos cubiertos");

  const cl = Object.keys(altClaseLatest).sort((a, b) => altClaseLatest[b] - altClaseLatest[a]);
  mkChart("chAltClase", { type: "doughnut", data: { labels: cl, datasets: [{ data: cl.map(c => altClaseLatest[c]),
    backgroundColor: cl.map(altColor), borderWidth: 2, borderColor: "#fff" }] },
    options: { cutout: "56%", plugins: { legend: { position: "right" }, tooltip: { callbacks: { label: c =>
      ` ${c.label}: ${fmtMM(c.parsed)} (${pct(100 * c.parsed / altSystemLatest)})` } } } } });

  const m = serieAltClaseSistema();
  mkChart("chAltTime", { type: "line", data: { labels: MESES, datasets: cl.map(c => ({ label: c, data: m[c],
    backgroundColor: altColor(c) + "cc", borderColor: altColor(c), fill: true, pointRadius: 0, borderWidth: 1, tension: .2 })) },
    options: { plugins: { legend: { position: "bottom" }, tooltip: moneyTip() }, scales: { x: xTime, y: Object.assign({ stacked: true }, axMoney()) } } });

  const order = [...AFPS.keys()].sort((a, b) => afpAltLatest[b] / afpTotalLatest[b] - afpAltLatest[a] / afpTotalLatest[a]);
  mkChart("chAltPen", { type: "bar", data: { labels: order.map(afpNameByIdx), datasets: [{ label: "% en alternativos",
    data: order.map(i => 100 * afpAltLatest[i] / afpTotalLatest[i]),
    backgroundColor: order.map(i => 100 * afpAltLatest[i] / afpTotalLatest[i] >= altPenSystem ? OK_GREEN : WARN) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false },
      tooltip: { callbacks: { label: c => ` ${pct(c.parsed.x)} (media sistema ${pct(altPenSystem)})` } } },
      scales: { x: { ticks: { callback: v => v + "%" } }, y: { grid: { display: false } } } } });

  const ord2 = [...AFPS.keys()].sort((a, b) => afpAltLatest[b] - afpAltLatest[a]);
  mkChart("chAltAfp", { type: "bar", data: { labels: ord2.map(afpNameByIdx), datasets: CLASES_ALT.map(cl => ({
    label: cl, data: ord2.map(i => afpAltClaseLatest[i + "|" + cl] || 0), backgroundColor: altColor(cl) })) },
    options: { plugins: { legend: { position: "bottom" }, tooltip: moneyTip() },
      scales: { x: { stacked: true, grid: { display: false } }, y: Object.assign({ stacked: true }, axMoney()) } } });

  const rows = [...AFPS.keys()].map(i => {
    const pen = 100 * afpAltLatest[i] / afpTotalLatest[i];
    return { i, name: afpNameByIdx(i), alt: afpAltLatest[i], tot: afpTotalLatest[i], pen, diff: pen - altPenSystem };
  }).sort((a, b) => a.pen - b.pen);
  const maxAlt = Math.max(...rows.map(r => r.alt));
  let html = `<thead><tr><th>AFP</th><th class="num">Patrimonio</th><th class="num">Alternativos</th>
    <th class="num">Exposición</th><th class="num">vs. sistema</th><th>Lectura comercial</th></tr></thead><tbody>`;
  rows.forEach(r => {
    let sig, cls;
    if (r.diff <= -1.5) { sig = "Oportunidad (sub-invertida)"; cls = "hi"; }
    else if (r.diff >= 1.5) { sig = "Cliente consolidado"; cls = "lo"; }
    else { sig = "En línea con pares"; cls = "mid"; }
    html += `<tr><td><b>${r.name}</b></td>
      <td class="num">${fmtMM(r.tot)}</td>
      <td class="num bar-cell"><div class="bar" style="width:${100 * r.alt / maxAlt}%"></div><span>${fmtMM(r.alt)}</span></td>
      <td class="num">${pct(r.pen)}</td>
      <td class="num opp ${cls}">${(r.diff >= 0 ? "+" : "")}${pct(r.diff).replace("%", " pp")}</td>
      <td class="opp ${cls}">${sig}</td></tr>`;
  });
  document.getElementById("tblOpp").innerHTML = html + "</tbody>";
}

/* ===========================================================================
   TAB: GESTORES / COMPETENCIA
   =========================================================================== */
let gestFilter = "local", gestClase = "__all__";
function renderGestores() {
  const sel = document.getElementById("gestClaseSel");
  sel.innerHTML = `<option value="__all__">Todas las clases</option>` + CLASES_ALT.map(c => `<option value="${c}">${c}</option>`).join("");
  sel.onchange = () => { gestClase = sel.value; drawGestores(); };
  const seg = document.getElementById("segGestor");
  if (!seg.dataset.wired) {
    seg.dataset.wired = "1";
    seg.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      gestFilter = b.dataset.f;
      document.querySelectorAll("#segGestor button").forEach(x => x.classList.toggle("active", x === b));
      drawGestores();
    });
  }
  drawGestores();
}
function gestAgg() {
  const out = {};
  GL.forEach(([g, loc, clase, afp, v]) => {
    if (gestClase !== "__all__" && clase !== gestClase) return;
    if (gestFilter === "local" && !loc) return;
    if (gestFilter === "global" && loc) return;
    if (!out[g]) out[g] = { mm: 0, local: loc, byAfp: {} };
    out[g].mm += v; out[g].byAfp[afp] = (out[g].byAfp[afp] || 0) + v;
  });
  return out;
}
function drawGestores() {
  const agg = gestAgg();
  const top = Object.entries(agg).sort((a, b) => b[1].mm - a[1].mm).slice(0, 15);
  document.getElementById("gestRankHint").textContent =
    `${gestFilter === "local" ? "AGF chilenas" : gestFilter === "global" ? "Gestores globales" : "Todos los gestores"}` +
    `${gestClase === "__all__" ? "" : " · " + gestClase} — monto en cartera AFP (último mes).`;

  mkChart("chGestRank", { type: "bar", data: { labels: top.map(t => t[0]), datasets: [{ label: "Monto",
    data: top.map(t => t[1].mm), backgroundColor: top.map(t => t[0] === "Ameris" ? AMERIS : (t[1].local ? C_TEAL : PEER)) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: axMoney(), y: { grid: { display: false } } } } });

  const wanted = top.slice(0, 8).map(t => t[0]).filter(g => D.gestores_serie.top.includes(g));
  const byG = {}; wanted.forEach(g => byG[g] = Array(MESES.length).fill(0));
  GS.forEach(([m, g, v]) => { if (byG[g]) byG[g][m] += v; });
  mkChart("chGestTime", { type: "line", data: { labels: MESES, datasets: wanted.map((g, k) => ({
    label: g, data: byG[g], borderColor: g === "Ameris" ? AMERIS : PALETTE[k % PALETTE.length],
    backgroundColor: "transparent", pointRadius: 0, borderWidth: g === "Ameris" ? 3 : 2, tension: .25 })) },
    options: { plugins: { legend: { position: "bottom" }, tooltip: moneyTip() }, scales: { x: xTime, y: axMoney() } } });

  const top30 = Object.entries(agg).sort((a, b) => b[1].mm - a[1].mm).slice(0, 30);
  const maxMM = top30.length ? top30[0][1].mm : 1;
  // máximo de celda (gestor×AFP) para el heatmap
  let maxCell = 1;
  top30.forEach(([g, o]) => AFPS.forEach(a => { if ((o.byAfp[a] || 0) > maxCell) maxCell = o.byAfp[a]; }));
  let html = `<thead><tr><th>Gestor</th><th>Tipo</th>` +
    AFPS.map(a => `<th class="num">${afpName(a)}</th>`).join("") + `<th class="num">Total</th></tr></thead><tbody>`;
  top30.forEach(([g, o]) => {
    const isAm = g === "Ameris";
    html += `<tr class="${isAm ? "ameris" : ""}"><td><b>${g}</b></td>
      <td>${isAm ? '<span class="tag ameris">Ameris</span>' : o.local ? '<span class="tag local">Local</span>' : '<span class="tag global">Global</span>'}</td>`;
    AFPS.forEach(a => {
      const v = o.byAfp[a] || 0;
      const al = v ? (0.10 + 0.62 * Math.sqrt(v / maxCell)) : 0;
      const st = v ? ` style="background:rgba(14,159,142,${al.toFixed(3)})"` : "";
      html += `<td class="num heat"${st}>${v ? fmtMM(v) : "<span class='z'>·</span>"}</td>`;
    });
    html += `<td class="num bar-cell"><div class="bar" style="width:${100 * o.mm / maxMM}%"></div><span><b>${fmtMM(o.mm)}</b></span></td></tr>`;
  });
  document.getElementById("tblGest").innerHTML = html + "</tbody>";

  drawMovers();
}

// "Flujos del mes" (estilo XLC): mayores entradas/salidas por gestor + cuota de mercado y su variación.
// Usa gestores_serie (monto mensual por gestor, universo alternativos). Respeta el filtro local/global/todos.
function drawMovers() {
  if (LAST < 1) return;
  const localOf = {}; GL.forEach(([g, loc]) => { if (!(g in localOf)) localOf[g] = loc; });
  const now = {}, prev = {}, prevY = {};
  GS.forEach(([m, g, v]) => {
    if (m === LAST) now[g] = (now[g] || 0) + v;
    else if (m === LAST - 1) prev[g] = (prev[g] || 0) + v;
    else if (LAST >= 12 && m === LAST - 12) prevY[g] = (prevY[g] || 0) + v;
  });
  // totales del universo (sin filtrar) para la cuota
  const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
  const totNow = sum(now) || 1, totPrev = sum(prev) || 1, totY = sum(prevY) || 1;
  const pass = g => gestFilter === "all" ? true
    : gestFilter === "local" ? (localOf[g] === 1 || g === "Ameris") : localOf[g] === 0;
  const rows = [...new Set([...Object.keys(now), ...Object.keys(prev)])].filter(pass).map(g => {
    const n = now[g] || 0, p = prev[g] || 0, y = prevY[g] || 0;
    return {
      g, now: n, delta: n - p, dpct: p ? 100 * (n / p - 1) : null,
      share: 100 * n / totNow,
      dMoM: 100 * n / totNow - 100 * p / totPrev,
      dYoY: prevY[g] !== undefined && LAST >= 12 ? 100 * n / totNow - 100 * y / totY : null,
      local: localOf[g]
    };
  });

  const mLbl = mesLbl(MESES[LAST]), mPrev = mesLbl(MESES[LAST - 1]);
  document.getElementById("moversHint").textContent = `Variación ${mLbl} vs. ${mPrev} (MM CLP).`;

  // Gráfico: mayores movimientos (por |variación|), barras divergentes
  const movers = rows.filter(r => Math.round(r.delta) !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 12)
    .sort((a, b) => a.delta - b.delta);
  mkChart("chMovers", {
    type: "bar", data: {
      labels: movers.map(r => r.g), datasets: [{
        data: movers.map(r => r.delta),
        backgroundColor: movers.map(r => r.g === "Ameris" ? AMERIS : (r.delta >= 0 ? OK_GREEN : WARN))
      }]
    },
    options: {
      indexAxis: "y", plugins: {
        legend: { display: false }, tooltip: {
          callbacks: { label: c => ` ${c.parsed.x >= 0 ? "+" : "−"}${fmtMM(Math.abs(c.parsed.x))} MM` }
        }
      },
      scales: { x: { ticks: { callback: v => fmtAxis(v) }, grid: { color: "#eef2f7" } }, y: { grid: { display: false } } }
    }
  });

  // Tabla: cuota de mercado y su variación
  const tbl = rows.filter(r => r.now > 0).sort((a, b) => b.share - a.share).slice(0, 14);
  const dpp = v => v == null ? '<span class="z">·</span>'
    : `<span class="k-delta ${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${pct(Math.abs(v)).replace("%", "")} pp</span>`;
  let h = `<thead><tr><th>Gestor</th><th class="num">Monto</th><th class="num">Δ monto mes</th>` +
    `<th class="num">Cuota</th><th class="num">Δ cuota m/m</th><th class="num">Δ cuota a/a</th></tr></thead><tbody>`;
  tbl.forEach(r => {
    const isAm = r.g === "Ameris";
    const dcls = r.delta >= 0 ? "up" : "down";
    h += `<tr class="${isAm ? "ameris" : ""}"><td><b>${r.g}</b></td>` +
      `<td class="num">${fmtMM(r.now)}</td>` +
      `<td class="num"><span class="k-delta ${dcls}">${r.delta >= 0 ? "+" : "−"}${fmtMM(Math.abs(r.delta))}</span></td>` +
      `<td class="num"><b>${pct(r.share)}</b></td>` +
      `<td class="num">${dpp(r.dMoM)}</td>` +
      `<td class="num">${dpp(r.dYoY)}</td></tr>`;
  });
  document.getElementById("tblMovers").innerHTML = h + "</tbody>";
}

/* ===========================================================================
   TAB: AMERIS
   =========================================================================== */
function renderAmeris() {
  const serie = Array(MESES.length).fill(0);
  AM.serie.data.forEach(([m, a, v]) => serie[m] += v);
  const totAm = serie[LAST], prev12 = LAST >= 12 ? serie[LAST - 12] : 0;
  const amByAfp = {};
  AM.serie.data.forEach(([m, a, v]) => { if (m === LAST) amByAfp[a] = (amByAfp[a] || 0) + v; });
  const nClientes = Object.values(amByAfp).filter(v => v > 0).length;
  const localAgg = {};
  GL.forEach(([g, loc, clase, afp, v]) => { if (loc) localAgg[g] = (localAgg[g] || 0) + v; });
  const localRank = Object.entries(localAgg).sort((a, b) => b[1] - a[1]);
  const amRank = localRank.findIndex(x => x[0] === "Ameris") + 1;
  const nFondos = AM.detalle.data.length;

  document.getElementById("kpiAmeris").innerHTML =
    kpiCard("Ameris en cartera AFP", fmtBig(totAm), deltaMoMYoY(serie, LAST), "spot")
    + kpiCard("Ranking AGF locales", amRank ? ("#" + amRank + " de " + localRank.length) : "—", "en activos alternativos", "spot")
    + kpiCard("AFP clientes", nClientes + " de " + AFPS.length, "con posición en fondos Ameris")
    + kpiCard("Fondos en cartera", nFondos, "vehículos distintos");

  mkChart("chAmTime", { type: "line", data: { labels: MESES, datasets: [{ label: "Ameris", data: serie,
    borderColor: AMERIS, backgroundColor: "rgba(0,72,216,.12)", fill: true, tension: .25, pointRadius: 0, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: xTime, y: axMoney() } } });

  const ord = Object.keys(amByAfp).map(Number).sort((a, b) => amByAfp[b] - amByAfp[a]);
  mkChart("chAmAfp", { type: "bar", data: { labels: ord.map(afpNameByIdx), datasets: [{ label: "Ameris",
    data: ord.map(i => amByAfp[i]), backgroundColor: ord.map(i => afpColor(i)) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: axMoney(), y: { grid: { display: false } } } } });

  const top = localRank.slice(0, 12);
  mkChart("chAmRank", { type: "bar", data: { labels: top.map(t => t[0]), datasets: [{ label: "Monto",
    data: top.map(t => t[1]), backgroundColor: top.map(t => t[0] === "Ameris" ? AMERIS : PEER) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: moneyTip() }, scales: { x: axMoney(), y: { grid: { display: false } } } } });

  const finClase = "Fondos de Inversión Nacionales";
  const ord2 = [...AFPS.keys()].filter(i => amByAfp[i]).sort((a, b) =>
    (amByAfp[b] || 0) / (afpAltClaseLatest[b + "|" + finClase] || 1) - (amByAfp[a] || 0) / (afpAltClaseLatest[a + "|" + finClase] || 1));
  mkChart("chAmShare", { type: "bar", data: { labels: ord2.map(afpNameByIdx), datasets: [{ label: "Cuota Ameris en FI nacional",
    data: ord2.map(i => 100 * (amByAfp[i] || 0) / (afpAltClaseLatest[i + "|" + finClase] || 1)), backgroundColor: ord2.map(i => afpColor(i)) }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${pct(c.parsed.x)} de los FI nacionales de la AFP` } } },
      scales: { x: { ticks: { callback: v => v + "%" } }, y: { grid: { display: false } } } } });

  const rows = AM.detalle.data.slice().sort((a, b) => b[3] - a[3]);
  const maxV = rows.length ? rows[0][3] : 1;
  let html = `<thead><tr><th>AFP</th><th>Fondo</th><th>Nemotécnico</th><th class="num">Monto</th><th class="num">Unidades</th></tr></thead><tbody>`;
  rows.forEach(r => {
    html += `<tr class="ameris"><td>${afpName(r[0])}</td><td><b>${fundNameOf(r[1], r[2])}</b></td><td><span class="nemo-code">${r[1] || "·"}</span></td>
      <td class="num bar-cell"><div class="bar" style="width:${100 * r[3] / maxV}%"></div><span>${fmtMM(r[3])}</span></td>
      <td class="num">${nf(r[4])}</td></tr>`;
  });
  document.getElementById("tblAmeris").innerHTML = html + "</tbody>";
}

/* ===========================================================================
   TAB: INSTRUMENTOS / FONDOS  (decodificación + lectura para Ameris)
   =========================================================================== */
function isinEntry(nemo) { const X = window.ISIN_MAP && window.ISIN_MAP.map; return X ? X[nemo] : null; }
// limpieza de nombres: arregla mojibake, quita el nemo pegado al final y aplica
// title-case en español (minúsculas para conectores, mayúsculas para siglas)
const _LOW = new Set(["de", "del", "la", "las", "los", "el", "y", "e", "o", "u", "en", "a", "al", "para", "por", "con", "da", "do"]);
const _UP = new Set(["sa", "spa", "agf", "etf", "plc", "llc", "lp", "bv", "nv", "ag", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "usd", "clp", "eur", "uf"]);
function cleanName(s, nemo) {
  if (!s) return "";
  s = String(s).trim().replace(/\s+/g, " ").replace(/INVERSI\?N/gi, "INVERSIÓN").replace(/\?/g, "");
  if (nemo) s = s.replace(new RegExp("\\s+" + nemo.replace(/[-./\\^$*+?()|[\]{}]/g, "\\$&") + "\\s*$", "i"), "");
  return s.toLowerCase().split(" ").map((w, i) =>
    !w ? w : _UP.has(w) ? w.toUpperCase() : (i > 0 && _LOW.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function decodeNemo(nemo, emisor) {
  const m = isinEntry(nemo);
  if (m && (m[0] || m[1])) return { name: cleanName(m[0] || emisor || nemo, nemo), isin: m[1] || "", desc: m[2] || "", src: "isin" };
  const looksIsin = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(nemo);
  // gestor global normalizado (p. ej. "CVC" -> "CVC Capital Partners"); no aplica a AGF locales
  const g = mgrOf(emisor);
  const name = (g.label && !g.local) ? g.label : (cleanName(emisor, nemo) || nemo);
  return { name: name, isin: looksIsin ? nemo : "", desc: "", src: "emisor" };
}
function mgrOf(emisor) {
  const t = (window.TAX && window.TAX.clasificarEmisor) ? window.TAX.clasificarEmisor(emisor) : [null, false, false];
  return { label: t[0], local: t[1], ameris: t[2] };
}
// directorio de nombres de fondos (Nemo.xlsx / ISIN_NEMOS).
// Lookup robusto: ignora guiones y resuelve PFI<->CFI (promesa <-> cuota del mismo fondo).
let _DIRNORM = null;
function dirName(nemo) {
  const D = window.FONDO_DIR; if (!D || !nemo) return "";
  if (!_DIRNORM) { _DIRNORM = Object.create(null); for (const k in D) _DIRNORM[k.replace(/-/g, "").toUpperCase()] = D[k]; }
  const u = nemo.replace(/-/g, "").toUpperCase();
  if (_DIRNORM[u]) return _DIRNORM[u];
  if (u.indexOf("PFI") === 0 && _DIRNORM["CFI" + u.slice(3)]) return _DIRNORM["CFI" + u.slice(3)];
  if (u.indexOf("CFI") === 0 && _DIRNORM["PFI" + u.slice(3)]) return _DIRNORM["PFI" + u.slice(3)];
  return "";
}
// nombre por el que se conoce el fondo:
// override manual del equipo > regla PFI > directorio de fondos (archivos) > emisor/ISIN > nemo
// Los nemotécnicos que empiezan con "PFI" (promesas) se rotulan como "Fondo de Iniciativa Privada".
function fundNameOf(nemo, emisor, dec) {
  const ov = window.FONDO_NOMBRES && window.FONDO_NOMBRES[nemo];
  if (ov && ov.trim()) return ov.trim();
  if (/^PFI/i.test(nemo)) return "Fondo de Iniciativa Privada";
  return dirName(nemo) || (dec || decodeNemo(nemo, emisor)).name || nemo;
}
function fundName(r) { return fundNameOf(r.nemo, r.emisor, r.dec); }
function mgrKeyOf(r) { return r.mgr.label || r.dec.name || r.emisor || r.nemo; }

// Clasifica un instrumento alternativo por TIPO DE ESTRATEGIA.
// Vehículos directos (VCPE/VDPE/VIPE/VRPE…) → por código (fiable).
// Fondos de inversión (CFI/PFI/FICE) → estimado por el NOMBRE del fondo.
function stratOf(r) {
  const clase = window.TAX ? window.TAX.clasificar(r.tipo).clase_alt : null;
  if (clase === "Capital Privado") return S_PE;
  if (clase === "Deuda Privada") return S_PD;
  if (clase === "Infraestructura") return S_INF;
  if (clase === "Inmobiliario / Real Estate") return S_RE;
  // Fondos de inversión → deducir del nombre real (evita el rótulo genérico de PFI usando dirName con swap).
  const nm = [
    (window.FONDO_NOMBRES && window.FONDO_NOMBRES[r.nemo]) || "",
    dirName(r.nemo) || "",
    (r.dec && r.dec.name) || "", r.emisor || ""
  ].join(" ").toLowerCase();
  const has = re => re.test(nm);
  if (has(/infraestruct|infra\b|energ|energy|solar|renovabl|renewable|transmis|vialid|concesi/)) return S_INF;
  if (has(/inmobili|hipotec|habitacion|vivienda|\brentas?\b|comercial|ra[íi]ces|real estate|leasing|\bmhe\b|propiedad|desarrollo urban/)) return S_RE;
  if (has(/deuda|debt|cr[ée]dito|credit|high yield|financ|colateraliz|colaterizado|factoring|fogape|senior|lending|bonos?/)) return S_PD;
  if (has(/private equity|\bequity\b|buyout|secondar|secundar|venture|growth|small cap|acciones|capital privado|co.?invers|coinvers|kkr|harbourvest|hamilton lane|\btpg\b|cinven|apax|carlyle|lexington|stepstone|permira|advent|blackstone|\bindex\b/)) return S_PE;
  // Rescate por patrón del nemotécnico (fondos habitacionales/hipotecarios chilenos y otros conocidos).
  const code = (r.nemo || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/DHS|ATHD|MHE|AFVV|DHIP|HIPOT/.test(code)) return S_RE;
  if (/PION/.test(code)) return S_PE;
  if (/INFR/.test(code)) return S_INF;
  return S_OTH;
}

const FOCO_FN = { fi: r => r.cat === "Alternativos", fm: r => r.cat === "Fondos Mutuos", all: () => true };
const FOCO_LBL = { fi: "fondos de inversión", fm: "fondos mutuos", all: "instrumentos" };
let instrFoco = "fi", instrSel = null;

function renderInstrumentos() {
  if (!instrRows.length) {
    document.getElementById("kpiInstr").innerHTML = `<div class="note">No hay datos de instrumentos en este conjunto. Vuelve a generar los datos (botón “Cargar datos”) con la versión más reciente.</div>`;
    return;
  }
  document.getElementById("instrSearch").oninput = drawInstr;
  document.getElementById("instrMulti").onchange = drawInstr;
  const chkAm = document.getElementById("instrAmeris");
  if (chkAm) chkAm.onchange = drawInstr;
  const seg = document.getElementById("instrFoco");
  if (!seg.dataset.wired) {
    seg.dataset.wired = "1";
    seg.addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
      instrFoco = b.dataset.f; document.querySelectorAll("#instrFoco button").forEach(x => x.classList.toggle("active", x === b));
      instrSel = null; instrHead(); drawInstr(); });
  }
  const concl = document.getElementById("instrConcl");
  if (concl && !concl.dataset.wired) { concl.dataset.wired = "1";
    concl.addEventListener("click", e => { const el = e.target.closest("[data-i]"); if (el) selectInstr(+el.dataset.i); }); }
  document.getElementById("instrLegend").innerHTML = "Presencia por AFP (puntos): " +
    AFPS.map((a, i) => `<span class="afp-leg"><i style="background:${afpColor(i)}"></i>${afpName(a)}</span>`).join("");
  instrHead();
  drawInstr();
}

function instrUniverse() { return instrRows.filter(FOCO_FN[instrFoco]); }
// suma por AFP de un conjunto de filas: devuelve {univ:[], amer:[]}
function afpSums(rows) {
  const univ = Array(AFPS.length).fill(0), amer = Array(AFPS.length).fill(0);
  rows.forEach(r => (instrByNemo[r.i] || []).forEach(([ai, v]) => { univ[ai] += v; if (r.mgr.ameris) amer[ai] += v; }));
  return { univ, amer };
}

// KPIs + Lecturas para Ameris (dependen del foco)
function instrHead() {
  const U = instrUniverse();
  const lbl = FOCO_LBL[instrFoco];
  const montoU = U.reduce((s, r) => s + r.total, 0);
  const managers = new Set(U.map(mgrKeyOf)).size;
  const amF = U.filter(r => r.mgr.ameris);
  const amMonto = amF.reduce((s, r) => s + r.total, 0);
  const amPresent = new Set(); amF.forEach(r => (instrByNemo[r.i] || []).forEach(([ai]) => amPresent.add(ai)));
  const amAbsent = [...AFPS.keys()].filter(k => !amPresent.has(k));

  document.getElementById("kpiInstr").innerHTML =
    kpiCard(`En cartera (${lbl})`, nf(U.length), `${fmtBig(montoU)} · ${mesLbl(M.mes_ultimo)}`, "accent")
    + kpiCard("Gestores presentes", nf(managers), `administradoras / emisores distintos`, "accent")
    + (PUB ? "" :
       kpiCard("Ameris en este universo", amF.length ? fmtBig(amMonto) : "—", `${amF.length} fondo(s)`, "spot")
       + kpiCard("Presencia de Ameris", amPresent.size + " de " + AFPS.length + " AFP",
           amAbsent.length ? ("ausente en " + amAbsent.map(afpNameByIdx).join(", ")) : "presente en todas", "spot"));

  if (!PUB) instrConclusiones(U, amF, amPresent, amAbsent);
}

function instrConclusiones(U, amF, amPresent, amAbsent) {
  const lbl = FOCO_LBL[instrFoco];
  // --- Card A: cobertura de Ameris ---
  let A = `<div class="card concl"><h4>Cobertura de Ameris</h4>`;
  if (!amF.length) {
    A += `<div class="sub">Ameris no tiene ${lbl} en la cartera de las AFP en el último mes.</div>`;
    if (instrFoco !== "fi") A += `<div class="sub">Cambia el foco a “Fondos de inversión” para ver su posición.</div>`;
  } else {
    const amMonto = amF.reduce((s, r) => s + r.total, 0);
    // agrupar por nombre de fondo (series y promesa+cuota del mismo fondo se combinan;
    // las promesas PFI caen todas en "Fondo de Iniciativa Privada")
    const gmap = {};
    amF.forEach(r => {
      const nm = fundName(r);
      const g = gmap[nm] || (gmap[nm] = { name: nm, total: 0, n: 0, afps: new Set(), best: r });
      g.total += r.total; g.n++;
      (instrByNemo[r.i] || []).forEach(([ai]) => g.afps.add(ai));
      if (r.total > g.best.total) g.best = r;
    });
    const gArr = Object.values(gmap).sort((a, b) => b.total - a.total);
    A += `<div class="big">${fmtBig(amMonto)}</div><div class="sub">${gArr.length} fondos · presente en ${amPresent.size} de ${AFPS.length} AFP</div>`;
    A += `<div class="gap-list"><div class="lbl">Presente en</div>` +
      [...amPresent].sort((a, b) => a - b).map(k => `<span class="chip-ok">${afpNameByIdx(k)}</span>`).join("") + `</div>`;
    if (amAbsent.length) {
      A += `<div class="gap-list"><div class="lbl">Ausente en — oportunidad de cross-sell</div>` +
        amAbsent.map(k => `<span class="chip-warn">${afpNameByIdx(k)}</span>`).join("") + `</div>`;
    }
    A += `<div class="gap-list"><div class="lbl">Fondos Ameris (monto en cartera)</div>` +
      `<table class="mini funds"><tbody>` +
      gArr.map(g => {
        const disp = g.name.replace(/^Ameris\s+/i, "");
        return `<tr data-i="${g.best.i}">` +
          `<td class="fn" title="${g.name.replace(/"/g, "&quot;")}">${disp}` +
          (g.n > 1 ? ` <span class="muted">·${g.n}</span>` : ``) + `</td>` +
          `<td class="num">${fmtMM(g.total)}</td><td class="num afpc">${g.afps.size} AFP</td></tr>`;
      }).join("") +
      `</tbody></table></div>`;
  }
  A += `</div>`;

  // --- Card B: fondos de competencia más adoptados ---
  const comp = U.filter(r => !r.mgr.ameris).slice().sort((a, b) => b.nafp - a.nafp || b.total - a.total).slice(0, 6);
  let B = `<div class="card concl"><h4>Competencia más adoptada</h4>` +
    `<div class="sub">Más AFP = producto “validado” por el mercado. Referencia competitiva para Ameris.</div><ol class="rank">`;
  comp.forEach(r => {
    B += `<li data-i="${r.i}"><span class="rk-main" title="${(fundName(r) + " (" + r.nemo + ")").replace(/"/g, "&quot;")}">${fundName(r)} <span class="nemo-paren">(${r.nemo})</span></span>` +
      `<span class="rk-val">${r.nafp} AFP · ${fmtBig(r.total)}</span></li>`;
  });
  B += `</ol></div>`;

  // --- Card C: apetito por AFP vs Ameris ---
  const { univ, amer } = afpSums(U);
  const order = [...AFPS.keys()].sort((a, b) => univ[b] - univ[a]);
  const maxU = Math.max(1, ...univ);
  // oportunidad limpia = AFP con apetito relevante pero SIN posición en Ameris
  const absentes = order.filter(k => !amer[k] && univ[k] > maxU * 0.05);
  const oppSet = new Set(absentes);
  let rowsHtml = "";
  order.forEach(k => {
    const share = univ[k] ? 100 * amer[k] / univ[k] : 0;
    rowsHtml += `<tr class="${oppSet.has(k) ? "opp" : ""}"><td>${afpNameByIdx(k)}</td>` +
      `<td class="num">${fmtMM(univ[k])}</td>` +
      `<td class="num ${amer[k] ? "ami" : "ami0"}">${amer[k] ? fmtMM(amer[k]) + ` <span class="muted">(${pct(share)})</span>` : "—"}</td></tr>`;
  });
  let C = `<div class="card concl"><h4>Apetito por ${lbl} vs. Ameris</h4>` +
    `<div class="sub">Cuánto invierte cada AFP en este universo y qué parte va a Ameris (cuota).</div>` +
    `<table class="mini"><thead><tr><th>AFP</th><th class="num">En ${lbl}</th><th class="num">Ameris</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  if (absentes.length) {
    const k = absentes[0];
    C += `<div class="opp-line">Mayor oportunidad: <b>${afpNameByIdx(k)}</b> invierte ${fmtBig(univ[k])} en ${lbl} y aún <b>no tiene fondos de Ameris</b>.</div>`;
  } else if (amF.length) {
    const pres = order.filter(k => amer[k]).sort((a, b) => amer[a] / (univ[a] || 1) - amer[b] / (univ[b] || 1));
    if (pres.length) { const k = pres[0];
      C += `<div class="opp-line">Menor exposición: en <b>${afpNameByIdx(k)}</b> Ameris es solo ${pct(100 * amer[k] / (univ[k] || 1))} de sus ${lbl} — espacio para crecer.</div>`; }
  }
  C += `</div>`;

  document.getElementById("instrConcl").innerHTML = A + B + C;
}

function afpDots(i) {
  const amt = {}; (instrByNemo[i] || []).forEach(([ai, v]) => amt[ai] = v);
  return `<span class="afp-dots">` + AFPS.map((a, k) => {
    const v = amt[k];
    return `<i class="${v ? "on" : "off"}" ${v ? `style="background:${afpColor(k)}"` : ""} title="${afpName(a)}: ${v ? fmtMM(v) : "no invierte"}"></i>`;
  }).join("") + `</span>`;
}

function instrFiltered() {
  const q = document.getElementById("instrSearch").value.trim().toLowerCase();
  const onlyMulti = document.getElementById("instrMulti").checked;
  const onlyAm = document.getElementById("instrAmeris").checked;
  return instrUniverse().filter(r => {
    if (onlyMulti && r.nafp < 2) return false;
    if (onlyAm && !r.mgr.ameris) return false;
    if (q && !(r.nemo + " " + fundName(r) + " " + dirName(r.nemo) + " " + r.dec.name + " " + (r.mgr.label || "") + " " + r.dec.isin + " " + r.emisor + " " + r.tipo).toLowerCase().includes(q)) return false;
    return true;
  });
}
function drawInstr() {
  const rows = instrFiltered();
  const totalF = rows.reduce((s, r) => s + r.total, 0);
  document.getElementById("instrInfo").innerHTML =
    `<b>${nf(rows.length)}</b> instrumentos · Total: <b>${fmtBig(totalF)}</b>` +
    (rows.length > 400 ? ` · mostrando los 400 mayores (refina la búsqueda)` : "");
  let html = `<thead><tr><th>Fondo / instrumento</th><th>Tipo</th><th>Presencia AFP</th><th class="num">Total</th></tr></thead><tbody>`;
  const maxV = rows.length ? rows[0].total : 1;
  rows.slice(0, 400).forEach(r => {
    const nm = fundName(r);
    const showMgr = r.mgr.label && nm.toLowerCase().indexOf(r.mgr.label.toLowerCase().split(" ")[0]) < 0;
    const sub = showMgr ? `<div class="fund-mgr">Gestor: ${r.mgr.label}</div>` : "";
    html += `<tr data-i="${r.i}" class="${r.mgr.ameris ? "ameris" : ""} ${instrSel === r.i ? "sel" : ""}">
      <td title="${(nm + " (" + r.nemo + ")").replace(/"/g, "&quot;")}">${r.mgr.ameris ? '<span class="star">★ </span>' : `<span class="src-dot ${r.dec.src}"></span>`}<b>${nm}</b> <span class="nemo-paren">(${r.nemo})</span>${sub}</td>
      <td>${r.tipo}</td>
      <td>${afpDots(r.i)}</td>
      <td class="num bar-cell"><div class="bar" style="width:${100 * r.total / maxV}%"></div><span>${fmtMM(r.total)}</span></td></tr>`;
  });
  const tbl = document.getElementById("tblInstr");
  tbl.innerHTML = html + "</tbody>";
  tbl.querySelectorAll("tbody tr").forEach(tr => tr.onclick = () => selectInstr(+tr.dataset.i));
  if ((instrSel == null || !rows.some(r => r.i === instrSel)) && rows.length) selectInstr(rows[0].i);
}

function selectInstr(i) {
  instrSel = i;
  document.querySelectorAll("#tblInstr tbody tr").forEach(tr => tr.classList.toggle("sel", +tr.dataset.i === i));
  const r = instrRows[i];
  const pares = (instrByNemo[i] || []).slice().sort((a, b) => b[1] - a[1]);
  const present = new Set(pares.map(p => p[0]));
  const absent = [...AFPS.keys()].filter(k => !present.has(k));
  const total = r.total, maxP = pares.length ? pares[0][1] : 1;
  document.getElementById("instrDetTitle").innerHTML = `${r.mgr.ameris ? "★ " : ""}${fundName(r)}`;
  document.getElementById("instrDetSub").innerHTML =
    `<span class="nemo-code">${r.nemo}</span> · ${r.tipo} · ${r.cat}` +
    (r.dec.isin && r.dec.isin !== r.nemo ? ` · ISIN <span class="det-isin">${r.dec.isin}</span>` : "") +
    (r.mgr.label ? ` · Gestor: <b>${r.mgr.label}</b>` : "");
  // dato clave
  let info = `<div class="det-key"><b>${fmtBig(total)}</b> invertido · presente en <b>${r.nafp}</b> de ${AFPS.length} AFP` +
    (r.dec.desc ? ` · ${r.dec.desc}` : "") + `</div>`;
  // una sola lista ordenada: color AFP + barra + monto + % del fondo
  info += `<div class="afpbars"><div class="lbl">Inversión por AFP</div>` +
    pares.map(p => `<div class="afpbar"><i class="dot" style="background:${afpColor(p[0])}"></i>` +
      `<span class="nm">${afpNameByIdx(p[0])}</span>` +
      `<span class="track"><span class="fill" style="width:${(100 * p[1] / maxP).toFixed(1)}%;background:${afpColor(p[0])}"></span></span>` +
      `<span class="val">${fmtMM(p[1])}</span><span class="pctv">${pct(100 * p[1] / total)}</span></div>`).join("") + `</div>`;
  // oportunidad / brecha
  if (absent.length) {
    info += `<div class="gap-list"><div class="lbl">${r.mgr.ameris ? "No lo tienen — oportunidad de cross-sell" : "No invierten"}</div>` +
      absent.map(k => `<span class="${r.mgr.ameris ? "chip-warn" : "afp-chip"}">${afpNameByIdx(k)}</span>`).join("") + `</div>`;
  }
  document.getElementById("instrDetInfo").innerHTML = info;
}

/* ===========================================================================
   TAB: EXPLORADOR
   =========================================================================== */
let exRows = [], exSort = { col: 7, dir: -1 };
const EX_COLS = ["afp", "fondo", "cat", "sub", "region", "tipo", "emisor", "mm"];
const EX_MMCOL = 7;
function renderExplorador() {
  const EX = D.explorador || { emisores: [], data: [] };
  const emisNames = (EX.emisores || []).map(e => cleanName(e) || "(sin emisor)");
  exRows = (EX.data || []).map(row => ({
    afp: AFPS[row[0]], fondo: row[1], cat: row[2], sub: row[3], region: row[4], tipo: row[5],
    emisor: emisNames[row[6]], mm: row[7]
  }));
  const fill = (id, vals, all) => { document.getElementById(id).innerHTML = `<option value="">${all}</option>` + vals.map(v => `<option>${v}</option>`).join(""); };
  fill("exAfp", AFPS.map(afpName), "Todas las AFP");
  fill("exCat", CATS.slice().sort(), "Todas las categorías");
  fill("exFondo", ["A", "B", "C", "D", "E"], "Todos los multifondos");
  fill("exRegion", ["Nacional", "Extranjero"], "Nacional + Extranjero");
  ["exAfp", "exCat", "exFondo", "exRegion"].forEach(id => document.getElementById(id).onchange = drawExplorador);
  document.getElementById("exSearch").oninput = drawExplorador;
  document.getElementById("exExport").onclick = exportCSV;
  drawExplorador();
}
function exFiltered() {
  const fa = document.getElementById("exAfp").value, fc = document.getElementById("exCat").value;
  const ff = document.getElementById("exFondo").value, fr = document.getElementById("exRegion").value;
  const q = document.getElementById("exSearch").value.trim().toLowerCase();
  return exRows.filter(r =>
    (!fa || afpName(r.afp) === fa) && (!fc || r.cat === fc) && (!ff || r.fondo === ff) && (!fr || r.region === fr) &&
    (!q || (r.emisor + " " + r.sub + " " + r.tipo + " " + r.cat).toLowerCase().includes(q)));
}
function drawExplorador() {
  let rows = exFiltered();
  rows.sort((a, b) => { const c = EX_COLS[exSort.col]; let x = a[c], y = b[c];
    if (c === "mm") return (x - y) * exSort.dir; return ("" + x).localeCompare("" + y) * exSort.dir; });
  const total = rows.reduce((s, r) => s + r.mm, 0);
  document.getElementById("exInfo").innerHTML = `<b>${nf(rows.length)}</b> filas · Total filtrado: <b>${fmtBig(total)}</b>`;
  const heads = [["afp", "AFP"], ["fondo", "Fondo"], ["cat", "Categoría"], ["sub", "Subclase"], ["region", "Origen"], ["tipo", "Instrumento"], ["emisor", "Emisor"], ["mm", "Monto"]];
  let html = `<thead><tr>` + heads.map((h, k) =>
    `<th class="${k === EX_MMCOL ? "num" : ""}" data-c="${k}">${h[1]}${exSort.col === k ? (exSort.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("") + `</tr></thead><tbody>`;
  const maxV = rows.length ? Math.max(...rows.map(r => r.mm)) : 1;
  rows.slice(0, 500).forEach(r => {
    html += `<tr><td>${afpName(r.afp)}</td><td>${r.fondo}</td><td>${r.cat}</td><td class="ex-sub" title="${r.sub}">${r.sub}</td>
      <td>${r.region}</td><td>${r.tipo}</td><td class="ex-emisor" title="${(r.emisor || "").replace(/"/g, "&quot;")}">${r.emisor || "·"}</td>
      <td class="num bar-cell"><div class="bar" style="width:${100 * r.mm / maxV}%"></div><span>${fmtMM(r.mm)}</span></td></tr>`;
  });
  if (rows.length > 500) html += `<tr><td colspan="8" class="muted">Mostrando las primeras 500 filas de ${nf(rows.length)}. Refina los filtros o exporta a CSV.</td></tr>`;
  const tbl = document.getElementById("tblExplorador");
  tbl.innerHTML = html + "</tbody>";
  tbl.querySelectorAll("thead th").forEach(th => th.onclick = () => {
    const c = +th.dataset.c; if (exSort.col === c) exSort.dir *= -1; else { exSort.col = c; exSort.dir = c === EX_MMCOL ? -1 : 1; } drawExplorador();
  });
}
function exportCSV() {
  const rows = exFiltered().sort((a, b) => b.mm - a.mm);
  const head = ["AFP", "Multifondo", "Categoria", "Subclase", "Origen", "Instrumento", "Emisor", "Monto_MM_CLP"];
  const lines = [head.join(";")].concat(rows.map(r => [afpName(r.afp), r.fondo, r.cat, r.sub, r.region, r.tipo, r.emisor, Math.round(r.mm)].join(";")));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `cartera_afp_${M.mes_ultimo}.csv`; a.click();
}

/* ===========================================================================
   MONEDA (CLP / USD)
   =========================================================================== */
function setupCurrency() {
  const seg = document.getElementById("segCur");
  const rateBox = document.getElementById("curRateWrap");
  const rateInp = document.getElementById("curRate");
  rateInp.value = CUR.rate;
  rateBox.style.display = CUR.mode === "USD" ? "" : "none";
  document.querySelectorAll("#segCur button").forEach(x => x.classList.toggle("active", x.dataset.cur === CUR.mode));
  seg.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    CUR.mode = b.dataset.cur;
    document.querySelectorAll("#segCur button").forEach(x => x.classList.toggle("active", x === b));
    rateBox.style.display = CUR.mode === "USD" ? "" : "none";
    refreshUnitPill(); rerender();
  });
  rateInp.addEventListener("change", () => {
    const v = parseFloat(rateInp.value); if (v > 0) { CUR.rate = v; if (CUR.mode === "USD") rerender(); }
  });
}
function rerender() { rendered = {}; showTab(currentTab); }

/* ===========================================================================
   CARGA DE DATOS EN EL NAVEGADOR + PERSISTENCIA (IndexedDB)
   =========================================================================== */
const DB_NAME = "ameris_afp", STORE = "bundles", KEY = "actual";
function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(fallback), ms))]);
}
function idbOpen() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === "undefined" || !indexedDB) return rej(new Error("sin IndexedDB"));
    let r; try { r = indexedDB.open(DB_NAME, 1); } catch (e) { return rej(e); }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("bloqueado"));
  });
}
async function idbGet() { try { const db = await idbOpen(); return await new Promise(res => {
  const g = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
  g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); }); } catch (e) { return null; } }
async function idbSet(obj) { try { const db = await idbOpen(); return await new Promise(res => {
  const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(obj, KEY);
  tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); } catch (e) { return false; } }
async function idbClear() { try { const db = await idbOpen(); return await new Promise(res => {
  const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(KEY);
  tx.oncomplete = () => res(true); tx.onerror = () => res(false); }); } catch (e) { return false; } }

function openLoader() { document.getElementById("loaderModal").classList.add("open"); }
function closeLoader() { document.getElementById("loaderModal").classList.remove("open"); }
let lastBundle = null;

function setupLoader() {
  // En el build público no se publica el cargador de CSV (ni procesar.js).
  if (!document.getElementById("loaderModal")) return;
  document.getElementById("btnActualizar").onclick = openLoader;
  document.getElementById("loaderClose").onclick = closeLoader;
  document.getElementById("loaderModal").addEventListener("click", e => { if (e.target.id === "loaderModal") closeLoader(); });

  const drop = document.getElementById("dropZone");
  const fileInp = document.getElementById("fileInput");
  drop.onclick = () => fileInp.click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("drag"); };
  drop.ondragleave = () => drop.classList.remove("drag");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("drag"); procesar(e.dataTransfer.files); };
  fileInp.onchange = () => procesar(fileInp.files);

  document.getElementById("btnDescargar").onclick = descargarBundle;
  const reset = document.getElementById("btnReset");
  if (reset) reset.onclick = async () => { await idbClear(); location.reload(); };
}

function setProgress(pct, txt) {
  document.getElementById("loaderBar").style.width = Math.round(pct * 100) + "%";
  if (txt) document.getElementById("loaderStatus").textContent = txt;
}
async function procesar(files) {
  const csvs = Array.from(files).filter(f => /\.csv$/i.test(f.name));
  if (!csvs.length) { document.getElementById("loaderStatus").textContent = "Selecciona archivos .csv (cartera_mensual_AAAA.csv)."; return; }
  document.getElementById("loaderResult").style.display = "none";
  document.getElementById("loaderProgress").style.display = "";
  setProgress(0, `Procesando ${csvs.length} archivo(s)…`);
  try {
    const bundle = await PROCESAR.procesarArchivos(csvs, p => {
      if (p.etapa === "procesando" || p.etapa === "leyendo")
        setProgress(p.pct, `Procesando ${p.archivo} (${p.fi + 1}/${p.total})…`);
      else if (p.etapa === "finalizando") setProgress(.99, "Generando agregados…");
    });
    lastBundle = bundle;
    await withTimeout(idbSet(bundle), 4000, false);   // persistir en este equipo (no bloquear si falla)
    initData(bundle); initHeader(); refreshUnitPill(); rerender();
    setProgress(1, "¡Listo!");
    const meta = bundle.meta;
    document.getElementById("loaderResult").style.display = "";
    document.getElementById("loaderResultTxt").innerHTML =
      `Datos cargados: <b>${meta.meses.length}</b> meses (${meta.meses[0]} → ${meta.mes_ultimo}), ` +
      `<b>${meta.afp_orden.length}</b> AFP. Patrimonio último mes: <b>${fmtBig(meta.total_sistema_ultimo_MM)}</b>. ` +
      `${meta.filas_corruptas_descartadas} filas inválidas descartadas.<br>` +
      `Se guardaron en este equipo. Para conservarlos de forma permanente y compartirlos, ` +
      `descarga <code>datos.js</code> y reemplázalo en la carpeta <code>dashboard/data/</code>.`;
  } catch (e) {
    setProgress(0, "Error: " + e.message);
  }
}
function descargarBundle() {
  if (!lastBundle) return;
  const txt = "window.AFP_DATA = " + JSON.stringify(lastBundle) + ";\n";
  const blob = new Blob([txt], { type: "text/javascript;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "datos.js"; a.click();
}

/* ===========================================================================
   BOOTSTRAP
   =========================================================================== */
function fatal(msg) {
  let b = document.getElementById("fatalBanner");
  if (!b) { b = document.createElement("div"); b.id = "fatalBanner";
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:999;background:#d4574e;color:#fff;padding:10px 16px;font:13px Segoe UI;white-space:pre-wrap";
    document.body.appendChild(b); }
  b.textContent = "⚠ " + msg;
}
window.addEventListener("error", e => fatal("Error: " + (e.message || e) + (e.filename ? " @ " + e.filename + ":" + e.lineno : "")));
window.addEventListener("unhandledrejection", e => fatal("Promesa rechazada: " + (e.reason && e.reason.message || e.reason)));

(async function boot() {
  let bundle = null;
  try { bundle = await withTimeout(idbGet(), 1500, null); } catch (e) {}
  if (!(bundle && bundle.meta)) bundle = window.AFP_DATA || null;
  if (!bundle) { document.body.innerHTML = "<p style='padding:40px'>No hay datos. Genera <code>data/datos.js</code> o carga los CSV.</p>"; return; }
  try { const q = new URLSearchParams(location.search); if ((q.get("cur") || "").toLowerCase() === "usd") CUR.mode = "USD"; } catch (e) {}
  initData(bundle);
  aplicarModoPublico();
  initHeader(); setupCurrency(); setupLoader();
  const t = (location.hash || "").replace("#", "");
  showTab(TABS[t] ? t : "resumen");
  window.addEventListener("hashchange", () => { const x = (location.hash || "").replace("#", ""); if (TABS[x]) showTab(x); });
  try { if (new URLSearchParams(location.search).get("cargar") === "1") openLoader(); } catch (e) {}
})();
