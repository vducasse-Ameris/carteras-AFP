/* ============================================================================
   Sobrescritura MANUAL de nombres de fondos — editable por el equipo de Ameris.
   Clave = nemotécnico; valor = nombre por el que quieres que se muestre el fondo.

   Tiene MÁXIMA PRIORIDAD: se impone por sobre el directorio de los archivos
   (Nemo.xlsx / ISIN_NEMOS) en la pestaña Instrumentos / Fondos, y se usa también
   en la búsqueda. Este archivo NO se sobrescribe al actualizar datos.

   Normalmente NO necesitas tocar esto: los nombres salen automáticamente de los
   archivos de la carpeta Datos. Úsalo solo para corregir o afinar un nombre
   puntual (p. ej. dejar el nombre comercial exacto de un fondo de Ameris).
   ============================================================================ */
window.FONDO_NOMBRES = {

  "CFIAFVVIII": "Ameris Financiamiento para Acceso a la Vivienda II",
  "CFIALEHI-E": "Ameris Leasing Habitacional",
  "CFIADMEXI":  "Ameris Deuda México",

  // Competencia / otros:
  "CFIDHS4I-E": "Activa Deuda Hipotecaria con Subsidio Habitacional IV",

  // Ejemplos (quita las // y edita para forzar un nombre):
  // "CFIXXXX":  "Ameris ...",

};
