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
  // El modo público lo define la AUSENCIA del módulo interno lib/ameris.js, no
  // los datos: así se mantiene aunque el usuario cargue CSV desde el navegador
  // (procesar.js recalcula una sección "ameris" que el sitio público ignora).
  PUB = !window.AMERIS_EXT;
  AM = PUB ? null : (D.ameris || null);
  INSTR = D.instrumentos || { nemos: [], data: [] };
  _intlRows = null; _feeders = null; _chilenos = null; _globKeys = null;   // se recalculan
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
  alternativos: { title: "Activos alternativos", desc: "Tamaño, crecimiento y distribución del mercado de activos alternativos de las AFP.", render: renderAlt },
  gestores: { title: "Gestores / Competencia", desc: "Quién administra los activos alternativos de las AFP.", render: renderGestores },
  instrumentos: { title: "Instrumentos / Fondos", desc: "Fondos por nemotécnico: qué AFP invierte en cada uno y quiénes los comparten.", render: renderInstrumentos },
  explorador: { title: "Explorador de datos", desc: "Consulta libre de la cartera del último mes disponible.", render: renderExplorador },
};
if (window.AMERIS_EXT) TABS.ameris = window.AMERIS_EXT.tab;

let rendered = {}, currentTab = "resumen";

// En modo público se retiran del DOM la pestaña "Posición Ameris" y los bloques
// de lectura comercial, y se neutraliza el texto de las descripciones.
function aplicarModoPublico() {
  if (!PUB) return;
  delete TABS.ameris;
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
  // Los textos con lectura comercial de Ameris viven en lib/ameris.js,
  // que no se copia al build público.
  if (window.AMERIS_EXT) s = window.AMERIS_EXT.execSum(tab,
        { g12, totAm, nCli, amRank, amAbsent });
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
  const vista = document.getElementById("segGestVista");
  if (vista && !vista.dataset.wired) {
    vista.dataset.wired = "1";
    vista.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      [...vista.children].forEach(x => x.classList.toggle("active", x === b));
      const v = b.dataset.v;
      document.getElementById("gestViewAlt").hidden = v !== "alt";
      document.getElementById("gestViewIntl").hidden = v !== "intl";
      document.getElementById("gestViewChil").hidden = v !== "chil";
      if (v === "intl") renderIntl();
      if (v === "chil") renderChilenos();
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

  // "top" puede faltar en bundles antiguos guardados en el navegador: sin él, no se filtra.
  const serieTop = (D.gestores_serie && D.gestores_serie.top) || null;
  const wanted = top.slice(0, 8).map(t => t[0]).filter(g => !serieTop || serieTop.includes(g));
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
/* ===========================================================================
   FONDOS INTERNACIONALES  (sub-vista de Gestores / Competencia)
   Vehículos de inversión con emisor extranjero, agrupados por la gestora que
   los administra. Se calcula desde `instrRows` (último snapshot), así que se
   actualiza solo con cada carga de datos.
   =========================================================================== */

// código de instrumento -> tipo de vehículo (solo fondos; sin bonos ni derivados)
const INTL_TIPOS = {
  CMEV: "Fondo mutuo", CMED: "Fondo mutuo",
  ETFA: "ETF", ETFB: "ETF", ETFC: "ETF",
  FICE: "Fondo de inversión", CIEV: "Fondo de inversión", CIED: "Fondo de inversión",
  VCPE: "Capital privado", ACPE: "Capital privado", CCPE: "Capital privado", KCPE: "Capital privado",
  VDPE: "Deuda privada", ADPE: "Deuda privada", CDPE: "Deuda privada", KDPE: "Deuda privada",
  CSIN: "Deuda privada",
  VIPE: "Infraestructura", AIPE: "Infraestructura", CIPE: "Infraestructura", KIPE: "Infraestructura",
  VRPE: "Inmobiliario", ARPE: "Inmobiliario", CRPE: "Inmobiliario", KRPE: "Inmobiliario",
};
const INTL_ORDEN = ["Fondo mutuo", "ETF", "Fondo de inversión", "Capital privado",
                    "Deuda privada", "Infraestructura", "Inmobiliario"];
const INTL_COLOR = { "Fondo mutuo": "#0a2a5e", "ETF": "#004cdc", "Fondo de inversión": "#1e9fe0",
  "Capital privado": "#33bffd", "Deuda privada": "#59dbd6", "Infraestructura": "#16b3a8",
  "Inmobiliario": "#0d7f77" };

// La fuente no trae la gestora como campo: se deduce del nombre del emisor.
// En fondos mutuos/ETF ese campo trae el nombre completo del fondo
// ("PIMCO FUNDS GLOBAL INVESTORS SERIES PLC..."); en capital privado, la gestora ("ARDIAN").
const INTL_MULTI = ["MORGAN STANLEY", "GOLDMAN SACHS", "T ROWE PRICE", "T. ROWE PRICE",
  "JANUS HENDERSON", "NEUBERGER BERMAN", "BAILLIE GIFFORD", "FRANKLIN TEMPLETON",
  "EDMOND DE ROTHSCHILD", "FIRST SENTIER", "NINETY ONE", "PARTNERS GROUP", "HARBOURVEST PARTNERS",
  "LEXINGTON PARTNERS", "ALPINVEST PARTNERS", "STEPSTONE GROUP", "BAIN CAPITAL", "ADAMS STREET",
  "PANTHEON VENTURES", "HAMILTON LANE", "NEW MOUNTAIN", "CAPITAL GROUP", "WELLINGTON MANAGEMENT",
  "LOOMIS SAYLES", "BNY MELLON", "BNP PARIBAS", "JULIUS BAER", "HARDING LOEVNER", "WILLIAM BLAIR",
  "POLAR CAPITAL", "STONE HARBOR", "LEGG MASON", "BROWN ADVISORY", "SILVER LAKE", "OAK HILL",
  "OAKTREE CAPITAL", "APOLLO GLOBAL", "ARES MANAGEMENT", "AUDAX GROUP", "BLACKSTONE",
  "CARLYLE GROUP", "CVC CAPITAL", "EQT ", "GENERAL ATLANTIC", "INSIGHT PARTNERS", "KKR ",
  "PERMIRA", "JORDAN COMPANY", "PROVIDENCE EQUITY", "SUMMIT PARTNERS", "TA ASSOCIATES",
  "THOMA BRAVO", "VISTA EQUITY", "WARBURG PINCUS", "ADVENT INTERNATIONAL", "CINVEN",
  "HELLMAN FRIEDMAN", "LEEDS EQUITY", "MADISON DEARBORN", "NORDIC CAPITAL", "PLATINUM EQUITY",
  "TPG ", "AMERICAN SECURITIES", "BERKSHIRE PARTNERS", "GENSTAR CAPITAL", "LINDEN CAPITAL",
  "GOLUB CAPITAL", "OWL ROCK", "SIXTH STREET", "BARINGS ", "MUZINICH", "ASHMORE", "MFS ",
  "GLOBAL INFRASTRUCTURE", "MONARCH ALTERNATIVE", "HPS INVESTMENT", "STONEPEAK", "NEW MOUNTAIN",
  "BROOKFIELD", "DIGITAL BRIDGE", "ANTIN INFRASTRUCTURE", "COPENHAGEN INFRASTRUCTURE",
  "PGIM ", "DWS ", "GAM ", "AXA ", "UBS ", "M&G", "ABRDN", "ABERDEEN", "MONEDA",
  "COMPASS GROUP", "LARRAIN VIAL", "LARRAINVIAL", "BTG PACTUAL", "CREDICORP CAPITAL",
  "SANTANDER ASSET", "ITAU ", "SURA ", "PRINCIPAL "].sort((a, b) => b.length - a.length);

const INTL_ALIAS = {
  ISHARES: "iShares (BlackRock)", BLACKROCK: "BlackRock", JPMORGAN: "J.P. Morgan AM",
  JPM: "J.P. Morgan AM", PIMCO: "PIMCO", SCHRODER: "Schroders", SCHRODERS: "Schroders",
  VANGUARD: "Vanguard", VONTOBEL: "Vontobel", LAZARD: "Lazard", MAN: "Man Group",
  AMUNDI: "Amundi", ROBECO: "Robeco", INVESCO: "Invesco", FIDELITY: "Fidelity",
  TEMPLETON: "Franklin Templeton", FRANKLIN: "Franklin Templeton", NORDEA: "Nordea",
  CANDRIAM: "Candriam", PICTET: "Pictet", CARMIGNAC: "Carmignac", JUPITER: "Jupiter",
  COMGEST: "Comgest", EASTSPRING: "Eastspring", MATTHEWS: "Matthews Asia", BLUEBAY: "BlueBay",
  ARTISAN: "Artisan Partners", ARDIAN: "Ardian", MONEDA: "Moneda (Patria)",
  COLUMBIA: "Columbia Threadneedle", THREADNEEDLE: "Columbia Threadneedle",
  ALLIANZ: "Allianz GI", HSBC: "HSBC AM", "GOLDMAN SACHS": "Goldman Sachs AM",
  "MORGAN STANLEY": "Morgan Stanley IM", "WELLINGTON MANAGEMENT": "Wellington",
  WELLINGTON: "Wellington", "T ROWE PRICE": "T. Rowe Price", "T. ROWE PRICE": "T. Rowe Price",
  "BAILLIE GIFFORD": "Baillie Gifford", "NINETY ONE": "Ninety One",
  "JANUS HENDERSON": "Janus Henderson", "NEUBERGER BERMAN": "Neuberger Berman",
  "PARTNERS GROUP": "Partners Group", "HARBOURVEST PARTNERS": "HarbourVest",
  "LEXINGTON PARTNERS": "Lexington Partners", "ALPINVEST PARTNERS": "AlpInvest",
  "STEPSTONE GROUP": "StepStone", "HAMILTON LANE": "Hamilton Lane", "ADAMS STREET": "Adams Street",
  "PANTHEON VENTURES": "Pantheon", "BAIN CAPITAL": "Bain Capital", "CAPITAL GROUP": "Capital Group",
  "BNY MELLON": "BNY Mellon IM", "BNP PARIBAS": "BNP Paribas AM", "FIRST SENTIER": "First Sentier",
  ABRDN: "abrdn", ABERDEEN: "abrdn", "CVC CAPITAL": "CVC Capital Partners",
  "OAKTREE CAPITAL": "Oaktree", "APOLLO GLOBAL": "Apollo", "ARES MANAGEMENT": "Ares",
  BLACKSTONE: "Blackstone", "CARLYLE GROUP": "Carlyle", "WARBURG PINCUS": "Warburg Pincus",
  "ADVENT INTERNATIONAL": "Advent International", "COMPASS GROUP": "Compass Group",
  "BTG PACTUAL": "BTG Pactual", LARRAINVIAL: "LarrainVial", "LARRAIN VIAL": "LarrainVial",
  "CREDICORP CAPITAL": "Credicorp Capital", EQT: "EQT", "JORDAN COMPANY": "The Jordan Company",
  "GLOBAL INFRASTRUCTURE": "Global Infrastructure Partners", "MONARCH ALTERNATIVE": "Monarch",
  "HPS INVESTMENT": "HPS", "ANTIN INFRASTRUCTURE": "Antin", "BROOKFIELD": "Brookfield",
  CVC: "CVC Capital Partners", "NEW MOUNTAIN": "New Mountain",
  "COPENHAGEN INFRASTRUCTURE": "Copenhagen Infrastructure", "STONEPEAK": "Stonepeak",
};
const INTL_SIGLAS = new Set(["DWS", "UBS", "AXA", "DFA", "SPDR", "EQT", "MFS", "PGIM", "GAM",
  "BNP", "HSBC", "JPM", "TCW", "RWC", "GQG", "KKR", "TPG", "CVC", "AQR", "LGT", "NN", "GMO",
  "BNY", "SEI", "TIAA", "PGGM", "HPS", "GIP"]);

const _tc = s => (window.TAX && window.TAX.titleCase) ? window.TAX.titleCase(s)
  : s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

function gestorIntl(emisor) {
  let n = (emisor || "").toUpperCase().replace(/[^A-Z0-9&. ]/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return "(sin emisor)";
  if (n.indexOf("THE ") === 0) n = n.slice(4);
  // familias que se reconocen por el nombre del vehículo, no por el del gestor
  if (n.indexOf("SELECT SECTOR SPDR") >= 0 || n.indexOf("SPDR") === 0) return "State Street (SPDR)";
  if (n.indexOf("DFA INVESTMENT") === 0 || n.indexOf("DIMENSIONAL") === 0) return "Dimensional (DFA)";
  for (const m of INTL_MULTI) {
    if (n.indexOf(m) === 0) {
      const k = m.trim();
      return INTL_ALIAS[k] || (INTL_SIGLAS.has(k) ? k : _tc(k));
    }
  }
  const tok = n.split(" ")[0];
  return INTL_ALIAS[tok] || (INTL_SIGLAS.has(tok) ? tok : _tc(tok));
}

// filas de fondos internacionales (se calcula una vez por carga de datos)
let _intlRows = null;
function intlRows() {
  if (_intlRows) return _intlRows;
  _intlRows = instrRows
    .filter(r => INTL_TIPOS[r.tipo] && window.TAX.clasificar(r.tipo).region === "Extranjero")
    .map(r => ({
      nemo: r.nemo, tipo: r.tipo, veh: INTL_TIPOS[r.tipo], nombre: r.emisor || r.nemo,
      gestor: gestorIntl(r.emisor), mm: r.total,
      afps: (instrByNemo[r.i] || []).slice().sort((a, b) => b[1] - a[1]),
    }))
    .sort((a, b) => b.mm - a.mm);
  return _intlRows;
}

/* ---------------------------------------------------------------------------
   FEEDERS LOCALES  —  qué AGF chilena canaliza a cada gestor global.
   La Superintendencia NO reporta un vínculo entre un fondo extranjero y una
   AGF local: cuando la AFP compra el fondo extranjero directamente, no hay
   intermediario chileno (el campo grupo_economico viene vacío en todo lo
   extranjero). El vínculo sí existe, pero en los FONDOS CHILENOS (CFI/PFI)
   que son feeders de una estrategia global y lo declaran en su nombre:
   "Picton-KKR Americas XII", "Moneda Carlyle Europe Partners V".
   Se detecta por nombre, así que depende del directorio de nombres de fondos.
   --------------------------------------------------------------------------- */
let _feeders = null;
function feedersLocales() {
  if (_feeders) return _feeders;
  _feeders = instrRows
    .filter(r => /^(CFI|PFI)/i.test(r.nemo) &&
                 window.TAX.clasificar(r.tipo).region === "Nacional")
    .map(r => ({
      nemo: r.nemo,
      nombre: dirName(r.nemo) || "",
      agf: r.mgr.label || r.emisor || "(sin gestor)",
      mm: r.total,
      afps: (instrByNemo[r.i] || []).slice().sort((a, b) => b[1] - a[1]),
    }))
    .filter(f => f.nombre);       // sin nombre no se puede detectar la estrategia
  return _feeders;
}

// Palabras demasiado genéricas para identificar una estrategia: si se usaran como
// clave, "Global" haría match con cualquier fondo chileno que diga "Global".
const CLAVE_STOP = new Set(["GLOBAL", "INMOBILIARIA", "INMOBILIARIO", "INTERNATIONAL",
  "INVESTMENT", "INVESTMENTS", "INVERSIONES", "FONDO", "FONDOS", "FUND", "FUNDS",
  "CAPITAL", "PRIVATE", "EQUITY", "ASSET", "TRUST", "INDEX", "SELECT", "RENTA",
  "RENTAS", "ADVISORS", "HOLDING", "GROUP", "PARTNERS", "MANAGEMENT", "INFRAESTRUCTURA",
  "DEUDA", "CREDITO", "ACCIONES", "MULTI", "DESARROLLO", "INMOBILIARIAS"]);

// claves de búsqueda de un gestor global dentro del nombre de un fondo chileno
function clavesGestor(label) {
  const s = (label || "").toUpperCase();
  const claves = [];
  const par = s.match(/\(([^)]+)\)/);          // "iShares (BlackRock)" -> BLACKROCK
  if (par) claves.push(par[1].trim());
  const base = s.replace(/\([^)]*\)/g, "").replace(/[.]/g, "").trim();
  if (base) claves.push(base);
  // quitar sufijos genéricos que no aportan ("AM", "IM", "GI", "GROUP")
  const corto = base.replace(/\b(AM|IM|GI|GROUP|PARTNERS|CAPITAL|MANAGEMENT)\b/g, "").trim();
  if (corto && corto.length >= 3) claves.push(corto);
  return [...new Set(claves.filter(k => k.length >= 3 && !CLAVE_STOP.has(k)))];
}

// Las siglas cortas (KKR, EQT, CVC) se buscan como palabra completa, para no
// dar falsos positivos dentro de otra palabra.
function _reClave(k) {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(k.length <= 4 ? "\\b" + esc + "\\b" : esc, "i");
}

function feedersDe(labelGestor) {
  const claves = clavesGestor(labelGestor);
  if (!claves.length) return [];
  return feedersLocales()
    .filter(f => claves.some(k => _reClave(k).test(f.nombre)))
    .sort((a, b) => b.mm - a.mm);
}

// resumen "AGF local" para la tabla de gestoras
function agfsDe(labelGestor) {
  const set = new Set(feedersDe(labelGestor).map(f => f.agf));
  return [...set];
}

function intlAgrupar(rows) {
  const m = new Map();
  for (const f of rows) {
    let g = m.get(f.gestor);
    if (!g) { g = { gestor: f.gestor, mm: 0, fondos: [], afps: new Set(), veh: new Set() }; m.set(f.gestor, g); }
    g.mm += f.mm; g.fondos.push(f); g.veh.add(f.veh);
    for (const a of f.afps) g.afps.add(a[0]);
  }
  return [...m.values()].sort((a, b) => b.mm - a.mm);
}

let intlVeh = "__all__", intlSel = null;

function renderIntl() {
  const sel = document.getElementById("intlVehSel");
  if (!sel.dataset.wired) {
    sel.dataset.wired = "1";
    const pres = INTL_ORDEN.filter(v => intlRows().some(f => f.veh === v));
    sel.innerHTML = `<option value="__all__">Todos los vehículos</option>` +
      pres.map(v => `<option value="${v}">${v}</option>`).join("");
    sel.onchange = () => { intlVeh = sel.value; intlSel = null; drawIntl(); };
    document.getElementById("intlSearch").oninput = () => { intlSel = null; drawIntl(); };
  }
  drawIntl();
}

function intlFiltrados() {
  const q = (document.getElementById("intlSearch").value || "").trim().toLowerCase();
  return intlRows().filter(f => {
    if (intlVeh !== "__all__" && f.veh !== intlVeh) return false;
    if (q && !(f.gestor + " " + f.nombre + " " + f.nemo).toLowerCase().includes(q)) return false;
    return true;
  });
}

function drawIntl() {
  const rows = intlFiltrados();
  const grupos = intlAgrupar(rows);
  const tot = rows.reduce((a, f) => a + f.mm, 0);

  // ---- KPI ----
  const nAfp = new Set(); rows.forEach(f => f.afps.forEach(a => nAfp.add(a[0])));
  const top10 = grupos.slice(0, 10).reduce((a, g) => a + g.mm, 0);
  document.getElementById("kpiIntl").innerHTML =
    kpiCard("Fondos internacionales", nf(rows.length), `${fmtBig(tot)} · ${mesLbl(M.mes_ultimo)}`, "accent")
    + kpiCard("Gestoras", nf(grupos.length), `presentes en ${nAfp.size} de ${AFPS.length} AFP`, "accent")
    + kpiCard("% del sistema AFP", tot && totalLatest ? pct(100 * tot / totalLatest) : "—",
        `sobre ${fmtBig(totalLatest)}`, "accent")
    + kpiCard("Concentración", tot ? pct(100 * top10 / tot) : "—", "en las 10 mayores gestoras", "accent");

  // ---- composición por vehículo ----
  const porVeh = INTL_ORDEN.map(v => [v, rows.filter(f => f.veh === v).reduce((a, f) => a + f.mm, 0)])
    .filter(x => x[1] > 0);
  mkChart("chIntlVeh", {
    type: "doughnut",
    data: { labels: porVeh.map(x => x[0]),
      datasets: [{ data: porVeh.map(x => cv(x[1])), backgroundColor: porVeh.map(x => INTL_COLOR[x[0]]),
        borderWidth: 0 }] },
    options: { cutout: "58%", plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 } } },
      tooltip: moneyTip() } }
  });

  // ---- ranking de gestoras ----
  const top = grupos.slice(0, 15);
  document.getElementById("intlRankHint").textContent =
    (intlVeh === "__all__" ? "Todas las gestoras" : intlVeh) + " — monto en cartera AFP (último mes).";
  mkChart("chIntlGest", {
    type: "bar",
    data: { labels: top.map(g => g.gestor),
      datasets: [{ label: "Monto", data: top.map(g => cv(g.mm)), backgroundColor: C_TEAL }] },
    options: { indexAxis: "y", plugins: { legend: { display: false }, tooltip: moneyTip() },
      scales: { x: axMoney(), y: { grid: { display: false } } } }
  });

  // ---- tabla de gestoras ----
  document.getElementById("intlGestHint").innerHTML =
    `<b>${nf(grupos.length)}</b> gestoras · <b>${nf(rows.length)}</b> fondos · <b>${fmtBig(tot)}</b>` +
     (grupos.length > 60 ? ` — se listan las 60 mayores; usa el buscador para el resto.` : "");
  const max = grupos.length ? grupos[0].mm : 1;
  let h = `<thead><tr><th>Gestora</th><th class="num">Fondos</th><th>AGF local (feeder)</th>
    <th>AFP</th><th class="num">Monto</th></tr></thead><tbody>`;
  grupos.slice(0, 60).forEach((g, i) => {
    const dots = AFPS.map((a, k) => {
      const on = g.afps.has(k);
      return `<i class="${on ? "on" : "off"}" ${on ? `style="background:${afpColor(k)}"` : ""}
        title="${afpNameByIdx(k)}${on ? "" : ": sin posición"}"></i>`;
    }).join("");
    h += `<tr data-g="${encodeURIComponent(g.gestor)}" class="clickable${intlSel === g.gestor ? " sel" : ""}">
      <td><b>${g.gestor}</b><div class="z" style="font-size:11.5px">${[...g.veh].join(" · ")}</div></td>
      <td class="num">${nf(g.fondos.length)}</td>
      <td style="font-size:12px">${(() => { const a = agfsDe(g.gestor);
        return a.length ? a.join(", ") : '<span class="z">directo</span>'; })()}</td>
      <td><span class="afp-dots">${dots}</span></td>
      <td class="num bar-cell"><div class="bar" style="width:${100 * g.mm / max}%"></div>
        <span><b>${fmtMM(g.mm)}</b></span></td></tr>`;
  });
  const tbl = document.getElementById("tblIntlGest");
  tbl.innerHTML = h + "</tbody>";
  if (!tbl.dataset.wired) {
    tbl.dataset.wired = "1";
    tbl.addEventListener("click", e => {
      const tr = e.target.closest("tr[data-g]"); if (!tr) return;
      intlSel = decodeURIComponent(tr.dataset.g);
      drawIntl();
    });
  }

  // ---- detalle de la gestora seleccionada ----
  const g = grupos.find(x => x.gestor === intlSel) || grupos[0];
  if (!g) {
    document.getElementById("intlDetTit").textContent = "Fondos";
    document.getElementById("intlDetSub").textContent = "Ningún fondo coincide con la búsqueda.";
    document.getElementById("tblIntlFondos").innerHTML = "";
    return;
  }
  document.getElementById("intlDetTit").textContent = g.gestor;
  document.getElementById("intlDetSub").innerHTML =
    `<b>${nf(g.fondos.length)}</b> fondo(s) · <b>${fmtBig(g.mm)}</b> · presente en
     <b>${g.afps.size} de ${AFPS.length}</b> AFP`;
  let f = `<thead><tr><th>Fondo</th><th>Vehículo</th><th class="num">Monto</th>
    <th>AFP con posición</th></tr></thead><tbody>`;
  g.fondos.slice().sort((a, b) => b.mm - a.mm).forEach(x => {
    f += `<tr><td><b>${x.nombre}</b><div class="z" style="font-size:11px">${x.nemo} · ${x.tipo}</div></td>
      <td><span class="tag" style="background:${INTL_COLOR[x.veh]};color:#fff;border:0">${x.veh}</span></td>
      <td class="num"><b>${fmtMM(x.mm)}</b></td>
      <td style="font-size:12px">${x.afps.map(a => afpNameByIdx(a[0])).join(", ") || "—"}</td></tr>`;
  });
  document.getElementById("tblIntlFondos").innerHTML = f + "</tbody>";

  // ---- feeders locales de esta gestora ----
  const fd = feedersDe(g.gestor);
  const box = document.getElementById("intlFeeders");
  if (!fd.length) {
    box.innerHTML = `<p class="hint" style="margin:0">Las AFP acceden a esta gestora
      <b>directamente</b>: no se detectan fondos chilenos que la canalicen.</p>`;
  } else {
    const totF = fd.reduce((a, x) => a + x.mm, 0);
    box.innerHTML = `<p class="hint" style="margin:0 0 8px">
      <b>${nf(fd.length)}</b> fondo(s) chileno(s) invierten en estrategias de
      <b>${g.gestor}</b> por <b>${fmtBig(totF)}</b>.</p>
      <div class="table-wrap"><table><thead><tr><th>AGF chilena</th><th>Fondo feeder</th>
      <th class="num">Monto</th></tr></thead><tbody>` +
      fd.map(x => `<tr><td><b>${x.agf}</b></td>
        <td>${x.nombre}<div class="z" style="font-size:11px">${x.nemo}</div></td>
        <td class="num"><b>${fmtMM(x.mm)}</b></td></tr>`).join("") +
      `</tbody></table></div>`;
  }
}

/* ---------------------------------------------------------------------------
   FONDOS CHILENOS: FEEDER vs. ESTRATEGIA LOCAL
   Un fondo chileno (CFI/PFI) es "feeder" cuando su nombre declara la estrategia
   global que replica ("Picton-KKR Americas XII"). Se detecta contra un
   diccionario de gestores globales construido con:
     · los gestores que ya aparecen en la vista de fondos internacionales, y
     · el listado de gestores globales conocidos (INTL_MULTI / INTL_ALIAS),
   descartando las AGF chilenas —para que el nombre de la propia administradora
   al inicio del fondo no lo marque como feeder— y las palabras genéricas.
   --------------------------------------------------------------------------- */
let _globKeys = null;
function clavesGlobales() {
  if (_globKeys) return _globKeys;
  // clave de búsqueda -> etiqueta comercial con la que se muestra el gestor
  const cand = new Map();
  const add = (k, label) => { if (!cand.has(k)) cand.set(k, label); };
  INTL_MULTI.forEach(m => {
    const k = m.trim().toUpperCase();
    add(k, INTL_ALIAS[k] || (INTL_SIGLAS.has(k) ? k : _tc(k)));
  });
  Object.values(INTL_ALIAS).forEach(v => clavesGestor(v).forEach(k => add(k, v)));
  intlAgrupar(intlRows()).forEach(g => clavesGestor(g.gestor).forEach(k => add(k, g.gestor)));

  // Palabras que son nombre de una AGF chilena presente en la cartera: no marcan
  // estrategia global. Se derivan de los propios datos, así que no hay que
  // mantener una lista a mano cuando entra una administradora nueva.
  const locales = new Set();
  instrRows.forEach(r => {
    if (!/^(CFI|PFI)/i.test(r.nemo)) return;
    const et = (r.mgr.label || r.emisor || "");
    et.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
      .forEach(t => { if (t.length >= 3) locales.add(t); });
  });

  _globKeys = [...cand.keys()]
    .filter(k => k.length >= 3 && !CLAVE_STOP.has(k))
    // fuera las AGF chilenas: no convierten a un fondo en feeder
    .filter(k => {
      const c = window.TAX.clasificarEmisor(k);
      if (c && c[1]) return false;
      return !k.split(" ").every(t => locales.has(t));
    })
    .map(k => ({ k, re: _reClave(k), label: cand.get(k) }))
    .sort((a, b) => b.k.length - a.k.length);   // primero la coincidencia más específica
  return _globKeys;
}

// Devuelve el gestor global que replica un fondo chileno, o "" si es estrategia local.
function estrategiaGlobalDe(nombreFondo) {
  if (!nombreFondo) return "";
  for (const { k, re, label } of clavesGlobales()) {
    if (re.test(nombreFondo)) return label || INTL_ALIAS[k] || (INTL_SIGLAS.has(k) ? k : _tc(k));
  }
  return "";
}

let _chilenos = null;
function fondosChilenos() {
  if (_chilenos) return _chilenos;
  _chilenos = instrRows
    .filter(r => /^(CFI|PFI)/i.test(r.nemo) && window.TAX.clasificar(r.tipo).region === "Nacional")
    .map(r => {
      const nombre = dirName(r.nemo) || "";
      return {
        nemo: r.nemo, nombre, tipo: r.tipo,
        agf: r.mgr.label || r.emisor || "(sin gestor)",
        mm: r.total,
        afps: (instrByNemo[r.i] || []).slice().sort((a, b) => b[1] - a[1]),
        // sin nombre no se puede determinar: se marca aparte, no como "local"
        clase: !nombre ? "?" : (estrategiaGlobalDe(nombre) ? "feeder" : "local"),
        global: nombre ? estrategiaGlobalDe(nombre) : "",
      };
    })
    .sort((a, b) => b.mm - a.mm);
  return _chilenos;
}

let chilFiltro = "todos";

function renderChilenos() {
  const seg = document.getElementById("segChil");
  if (!seg.dataset.wired) {
    seg.dataset.wired = "1";
    seg.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      chilFiltro = b.dataset.c;
      [...seg.children].forEach(x => x.classList.toggle("active", x === b));
      drawChilenos();
    });
    document.getElementById("chilSearch").oninput = drawChilenos;
  }
  drawChilenos();
}

function drawChilenos() {
  const todos = fondosChilenos();
  const q = (document.getElementById("chilSearch").value || "").trim().toLowerCase();
  const rows = todos.filter(f => {
    if (chilFiltro !== "todos" && f.clase !== chilFiltro) return false;
    if (q && !(f.nombre + " " + f.agf + " " + f.nemo + " " + f.global).toLowerCase().includes(q)) return false;
    return true;
  });

  const suma = a => a.reduce((x, f) => x + f.mm, 0);
  const fee = todos.filter(f => f.clase === "feeder"), loc = todos.filter(f => f.clase === "local"),
        ind = todos.filter(f => f.clase === "?");
  const totCon = suma(fee) + suma(loc);

  document.getElementById("kpiChil").innerHTML =
    kpiCard("Fondos chilenos en cartera", nf(todos.length), `${fmtBig(suma(todos))} · ${mesLbl(M.mes_ultimo)}`, "accent")
    + kpiCard("Feeder de un gestor global", nf(fee.length), fmtBig(suma(fee)), "accent")
    + kpiCard("Estrategia local", nf(loc.length), fmtBig(suma(loc)), "accent")
    + kpiCard("Peso de los feeder", totCon ? pct(100 * suma(fee) / totCon) : "—",
        ind.length ? `${nf(ind.length)} sin nombre, no clasificados` : "sobre los fondos con nombre", "accent");

  document.getElementById("chilHint").innerHTML =
    `<b>${nf(rows.length)}</b> fondo(s) · <b>${fmtBig(suma(rows))}</b>`;

  let h = `<thead><tr><th>Fondo</th><th>AGF chilena</th><th>Tipo de estrategia</th>
    <th class="num">Monto</th><th>AFP</th></tr></thead><tbody>`;
  rows.slice(0, 120).forEach(f => {
    const badge = f.clase === "feeder"
      ? `<span class="tag" style="background:#004cdc;color:#fff;border:0">Feeder</span>
         <span style="font-size:12px;margin-left:6px">${f.global}</span>`
      : f.clase === "local"
        ? `<span class="tag" style="background:#16b3a8;color:#fff;border:0">Local</span>`
        : `<span class="tag" style="background:#e2e8f0;color:#64748b;border:0">Sin nombre</span>`;
    h += `<tr><td><b>${f.nombre || "(sin nombre en el directorio)"}</b>
        <div class="z" style="font-size:11px">${f.nemo} · ${f.tipo}</div></td>
      <td style="font-size:12.5px">${f.agf}</td>
      <td>${badge}</td>
      <td class="num"><b>${fmtMM(f.mm)}</b></td>
      <td style="font-size:11.5px">${f.afps.map(a => afpNameByIdx(a[0])).join(", ") || "—"}</td></tr>`;
  });
  document.getElementById("tblChil").innerHTML = h + "</tbody>";
  document.getElementById("chilMas").innerHTML = rows.length > 120
    ? `Se listan los 120 mayores de ${nf(rows.length)}. Usa el buscador para el resto.` : "";
}

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

// KPIs de la pestaña de instrumentos (dependen del foco)
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

  if (!PUB && window.AMERIS_EXT) window.AMERIS_EXT.conclusiones(U, amF, amPresent, amAbsent);
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
  const chkAm = document.getElementById("instrAmeris");   // no existe en el build público
  const onlyAm = !!(chkAm && chkAm.checked);
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
    // la etiqueta comercial la aporta lib/ameris.js (uso interno); sin él, texto neutro
    const gap = (!PUB && window.AMERIS_EXT) ? window.AMERIS_EXT.gapLabel(r) : null;
    info += `<div class="gap-list"><div class="lbl">${gap ? gap.lbl : "No invierten"}</div>` +
      absent.map(k => `<span class="${gap ? gap.chip : "afp-chip"}">${afpNameByIdx(k)}</span>`).join("") + `</div>`;
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
  // El bundle guardado en el navegador solo se usa donde existe el cargador de CSV.
  // En el build público no lo hay, y además en file:// todas las páginas comparten
  // el mismo IndexedDB: sin esto, el sitio público levantaría el bundle interno.
  if (document.getElementById("loaderModal")) {
    try { bundle = await withTimeout(idbGet(), 1500, null); } catch (e) {}
  }
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
