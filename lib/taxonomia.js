/* ===========================================================================
   taxonomia.js — Puerto JS de etl/taxonomia.py
   Decodifica tipo_de_instrumento (Anexo I del manual) y clasifica emisores.
   Funciona en navegador (self.TAX) y en Node (module.exports).
   =========================================================================== */
(function (global) {
  "use strict";

  const CAT_RF = "Renta Fija", CAT_RV = "Renta Variable", CAT_FM = "Fondos Mutuos",
        CAT_ALT = "Alternativos", CAT_DER = "Derivados", CAT_CAJA = "Caja y otros";
  const ALT_PE = "Capital Privado", ALT_PD = "Deuda Privada", ALT_INFRA = "Infraestructura",
        ALT_RE = "Inmobiliario / Real Estate",
        ALT_FIN = "Fondos de Inversión Nacionales", ALT_FIE = "Fondos de Inversión Extranjeros";
  const NACIONAL = "Nacional", EXTRANJERO = "Extranjero";

  const MAP = {};
  function add(codes, cat, sub, region, claseAlt) {
    claseAlt = claseAlt || null;
    codes.forEach(c => { MAP[c] = [cat, sub, region, claseAlt]; });
  }
  // Renta fija nacional
  add(["BBC","BCD","BCP","BCU","BCX","PCX","PDC","PRC","PRD"], CAT_RF, "Banco Central", NACIONAL);
  add(["BTP","BTU","PTG","BEC","BCO","BRP"], CAT_RF, "Tesorería / Estado", NACIONAL);
  add(["DEB","BCA","BCS","BVL","ELN"], CAT_RF, "Bonos de empresas", NACIONAL);
  add(["BEF","BSF","BHM","LHF","LTP"], CAT_RF, "Bonos e instrumentos bancarios", NACIONAL);
  add(["DPF"], CAT_RF, "Depósitos a plazo", NACIONAL);
  add(["ECO","ECS"], CAT_RF, "Efectos de comercio", NACIONAL);
  add(["CERO","ZERO"], CAT_RF, "Cupones reajustables", NACIONAL);
  add(["BFI"], CAT_RF, "Bonos de fondos de inversión", NACIONAL);
  // Renta fija extranjera
  add(["BEE","BSE","BCE"], CAT_RF, "Bonos de empresas extranjeras", EXTRANJERO);
  add(["TBE","TBI","CDE","TDP","OVN","ABE","ECE"], CAT_RF, "Bancaria extranjera", EXTRANJERO);
  add(["EBC","TGE"], CAT_RF, "Deuda soberana extranjera", EXTRANJERO);
  add(["ADD"], CAT_RF, "Deuda vía depositario (ADD)", EXTRANJERO);
  add(["ETFB"], CAT_RF, "ETF renta fija", EXTRANJERO);
  add(["XERO"], CAT_RF, "Cupones BCCh USD", NACIONAL);
  // Renta variable
  add(["ACC","ASC","SPA","EPA","OSAN"], CAT_RV, "Acciones nacionales", NACIONAL);
  add(["AEE","ADR","OSAE"], CAT_RV, "Acciones extranjeras", EXTRANJERO);
  add(["ETFA"], CAT_RV, "ETF accionario", EXTRANJERO);
  add(["ETFC"], CAT_RV, "ETF commodities", EXTRANJERO);
  // Fondos mutuos
  add(["CFMD"], CAT_FM, "FM nacional - deuda", NACIONAL);
  add(["CFMV"], CAT_FM, "FM nacional - accionario/mixto", NACIONAL);
  add(["CMED"], CAT_FM, "FM extranjero - deuda", EXTRANJERO);
  add(["CMEV"], CAT_FM, "FM extranjero - accionario/mixto", EXTRANJERO);
  // Alternativos
  add(["VCPE","ACPE","CCPE","KCPE"], CAT_ALT, "Capital privado", EXTRANJERO, ALT_PE);
  add(["VDPE","ADPE","CDPE","KDPE","CDCS","CSIN"], CAT_ALT, "Deuda privada", EXTRANJERO, ALT_PD);
  add(["VIPE","AIPE","CIPE","KIPE"], CAT_ALT, "Infraestructura", EXTRANJERO, ALT_INFRA);
  add(["VRPE","ARPE","CRPE","KRPE","VRPI","ARPI"], CAT_ALT, "Inmobiliario (vehículos)", EXTRANJERO, ALT_RE);
  add(["RAIZ","CREN","CLEA","MHE"], CAT_ALT, "Inmobiliario nacional", NACIONAL, ALT_RE);
  add(["CFID"], CAT_ALT, "FI nacional - deuda", NACIONAL, ALT_FIN);
  add(["CFIV"], CAT_ALT, "FI nacional - capital/mixto", NACIONAL, ALT_FIN);
  add(["PFI"], CAT_ALT, "FI nacional - promesas", NACIONAL, ALT_FIN);
  add(["FICE","CIEV"], CAT_ALT, "FI extranjero - capital/mixto", EXTRANJERO, ALT_FIE);
  add(["CIED"], CAT_ALT, "FI extranjero - deuda", EXTRANJERO, ALT_FIE);
  // Caja
  add(["CC2"], CAT_CAJA, "Cuenta corriente nacional", NACIONAL);
  add(["CC3"], CAT_CAJA, "Cuenta corriente extranjera", EXTRANJERO);

  const ALT_SEG = { C:[ALT_PE,"Capital privado"], D:[ALT_PD,"Deuda privada"],
                    I:[ALT_INFRA,"Infraestructura"], R:[ALT_RE,"Inmobiliario (vehículos)"] };

  function privado(code) {
    const m = /^[VACK]([CDIR])P[EI]$/.exec(code);
    if (m) { const s = ALT_SEG[m[1]]; return [CAT_ALT, s[1], EXTRANJERO, s[0]]; }
    return null;
  }
  function derivado(code) {
    if (/^(X|Y)?S[A-Z]{2}$/.test(code) || code === "SIN") {
      const region = code.slice(1).indexOf("E") >= 0 ? EXTRANJERO : NACIONAL;
      return [CAT_DER, "Swaps", region, null];
    }
    if (/^F[EN][AIMT][CV]$/.test(code)) return [CAT_DER, "Futuros", code[1]==="E"?EXTRANJERO:NACIONAL, null];
    if (/^O[EN][AIMT][CV]$/.test(code)) return [CAT_DER, "Opciones", code[1]==="E"?EXTRANJERO:NACIONAL, null];
    if (/^[WXY][EN][AIMNT][CV]$/.test(code)) return [CAT_DER, "Forwards", code[1]==="E"?EXTRANJERO:NACIONAL, null];
    return null;
  }

  const cacheTipo = {};
  function clasificar(code) {
    code = (code || "").trim().toUpperCase();
    let r = cacheTipo[code];
    if (r) return r;
    let res = MAP[code] || privado(code) || derivado(code) || [CAT_CAJA, "Otros / no clasificado", NACIONAL, null];
    r = { categoria: res[0], subclase: res[1], region: res[2],
          es_alternativo: res[3] !== null, clase_alt: res[3] };
    cacheTipo[code] = r;
    return r;
  }

  /* ----------------------- Emisores / gestores ----------------------- */
  function norm(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ").trim().toUpperCase();
  }
  // [substring, etiqueta, esAmeris]
  const AGF_LOCALES = [
    ["AMERIS","Ameris",true],
    ["MONEDA","Moneda / Patria",false],
    ["COMPASS","Compass Group",false],
    ["LARRAIN VIAL","LarrainVial",false],
    ["LARRAINVIAL","LarrainVial",false],
    ["BTG PACTUAL","BTG Pactual",false],
    ["PICTON","Picton",false],
    ["CREDICORP","Credicorp Capital",false],
    ["HMC","HMC Capital",false],
    ["INDEPENDENCIA","Independencia",false],
    ["SECURITY","Security",false],
    ["BICE","BICE Inversiones",false],
    ["BANCHILE","Banchile",false],
    ["SANTANDER","Santander AM",false],
    ["ITAU","Itaú AM",false],
    ["PRINCIPAL","Principal",false],
    ["ZURICH","Zurich Chile",false],
    ["SURA","SURA IM",false],
    ["FALCOM","Falcom",false],
    ["SINGULAR","Singular",false],
    ["FRONTAL TRUST","Frontal Trust",false],
    ["LINK CAPITAL","Link Capital",false],
    ["SARTOR","Sartor",false],
    ["TOESCA","Toesca",false],
    ["FYNSA","Fynsa",false],
    ["TANNER","Tanner",false],
    ["NEVASA","Nevasa",false],
    ["VOLCOMETAL","Volcomcapital",false],
    ["VOLCOM","Volcomcapital",false],
    ["WEG ","WEG",false],
    ["ECUS","Ecus",false],
    ["ACTIVA","Activa",false],
    ["ABERDEEN","abrdn Chile",false],
    ["PENTA","Penta",false],
    ["EUROAMERICA","EuroAmerica",false],
    ["VANTRUST","VanTrust",false],
    ["CONTINENTAL","Continental",false],
    ["AURUS","Aurus",false],
    ["CHILENA CONSOLIDADA","Chilena Consolidada",false],
  ];
  function esAgfChilena(n) {
    return n.indexOf("ADM. GENERAL DE FONDOS") >= 0
      || n.indexOf("ADMINISTRADORA GENERAL DE FONDOS") >= 0
      || n.indexOf("ADM. GRAL") >= 0
      || n.indexOf("ADMINISTRADORA GENERAL") >= 0
      || n.indexOf("ADM GENERAL DE FONDOS") >= 0
      || n.indexOf("ADM. DE FONDOS DE INVERSION") >= 0
      || n.indexOf("S.A. ADM") >= 0;
  }
  // alias de gestores globales (no locales) abreviados/partidos en la fuente
  function aliasGlobal(n) {
    if (n === "CVC" || n.indexOf("CVC CAPITAL") === 0) return "CVC Capital Partners";
    return null;
  }
  function titleCase(s) {
    return (s || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  const cacheEmisor = {};
  function clasificarEmisor(nombre) {
    let r = cacheEmisor[nombre];
    if (r) return r;
    const n = norm(nombre);
    r = null;
    for (let i = 0; i < AGF_LOCALES.length; i++) {
      if (n.indexOf(AGF_LOCALES[i][0]) >= 0) { r = [AGF_LOCALES[i][1], true, AGF_LOCALES[i][2]]; break; }
    }
    if (!r) { const ga = aliasGlobal(n); if (ga) r = [ga, false, false]; }
    if (!r) r = esAgfChilena(n) ? [titleCase((nombre || "").trim()).slice(0, 40), true, false] : [null, false, false];
    cacheEmisor[nombre] = r;
    return r;
  }

  const AFP_NOMBRE = {
    cup:"Cuprum", hab:"Habitat", prv:"Provida", cap:"Capital", uno:"Uno",
    pli:"PlanVital", mod:"Modelo", bsa:"Bansander", sta:"Santa María", sum:"Summa",
    mag:"Magister", prt:"Protección", fom:"Fomenta", qua:"Qualitas", val:"Valora",
    apo:"Aporta", arm:"Armoniza", fut:"Futuro", uni:"Union",
  };

  const Tax = { clasificar, clasificarEmisor, titleCase, AFP_NOMBRE,
                CLASES_ALT: [ALT_PE, ALT_PD, ALT_INFRA, ALT_RE, ALT_FIN, ALT_FIE] };
  if (typeof module !== "undefined" && module.exports) module.exports = Tax;
  global.TAX = Tax;
})(typeof self !== "undefined" ? self : this);
