// ---------------------------------------------------------------------------
// El "día operativo" del panel, del lado de la web.
//
// Copia de functions/src/cortesDiarios.ts y de la misma utilidad en la app
// (src/utils/diaOperativo.ts del repo de la app). Los tres tienen que decir lo
// mismo: el día del panel NO va de medianoche a medianoche, va de las 2:00 a
// las 2:00 (hora argentina), que es cuando se cierra el día y se guarda el CSV.
//
// Si la pantalla recortara por fecha de calendario y el backend por el corte
// de las 2:00, elegir "ayer" mostraría dos horas de operaciones que el archivo
// de ayer ya no tiene. Por eso las fechas viajan en milisegundos ya alineadas
// al corte, y no como "2026-09-16".
//
// Argentina es UTC-3 todo el año: el desfase va explícito y no se le pregunta
// la zona al navegador, que puede estar en cualquier lado.
// ---------------------------------------------------------------------------

const DESFASE_ARGENTINA_HS = 3;
const HORA_DEL_CORTE = 2;
const UN_DIA_MS = 86_400_000;

export type Ventana = { desde: number; hasta: number } | null;

/** El momento en que arrancó el día operativo que contiene a `ms`. */
export function inicioDelDiaOperativo(ms: number = Date.now()): number {
  const desfaseMs = DESFASE_ARGENTINA_HS * 3600_000;
  const enArgentina = ms - desfaseMs;
  const diaEnArgentina = Math.floor(enArgentina / UN_DIA_MS) * UN_DIA_MS;
  let corte = diaEnArgentina + HORA_DEL_CORTE * 3600_000 + desfaseMs;
  if (corte > ms) corte -= UN_DIA_MS;
  return corte;
}

/** El corte siguiente: sirve como `hasta`, que es exclusivo. */
export function finDelDiaOperativo(ms: number = Date.now()): number {
  return inicioDelDiaOperativo(ms) + UN_DIA_MS;
}

/**
 * La ventana de una fecha de calendario ("2026-09-16"), de corte a corte.
 *
 * Se arma a mediodía a propósito: las 00:00 de esa fecha caen ANTES del corte
 * de las 2:00 y devolverían la ventana del día anterior.
 */
export function ventanaDeLaFecha(iso: string): { desde: number; hasta: number } {
  const [y, m, d] = iso.split('-').map((n) => Number(n));
  const mediodiaArgentina = Date.UTC(y, (m || 1) - 1, d || 1, 12 + DESFASE_ARGENTINA_HS, 0, 0);
  const desde = inicioDelDiaOperativo(mediodiaArgentina);
  return { desde, hasta: desde + UN_DIA_MS };
}

/** La ventana de un rango, con las dos puntas incluidas. */
export function ventanaDelRango(desdeIso: string, hastaIso: string): { desde: number; hasta: number } {
  const a = ventanaDeLaFecha(desdeIso);
  const b = ventanaDeLaFecha(hastaIso);
  return { desde: Math.min(a.desde, b.desde), hasta: Math.max(a.hasta, b.hasta) };
}

/** La ventana de los últimos `dias` días operativos, contando el de hoy. */
export function ventanaDeLosUltimos(dias: number): { desde: number; hasta: number } {
  const hasta = finDelDiaOperativo();
  return { desde: hasta - dias * UN_DIA_MS, hasta };
}

/** "2026-09-16" para la fecha argentina de ese momento. */
export function fechaIso(ms: number = Date.now()): string {
  const enArgentina = new Date(ms - DESFASE_ARGENTINA_HS * 3600_000);
  const y = enArgentina.getUTCFullYear();
  const m = String(enArgentina.getUTCMonth() + 1).padStart(2, '0');
  const d = String(enArgentina.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Cómo se lee una ventana: "16/09", "del 10/09 al 16/09", "Todo". */
export function comoSeLee(rango: Ventana): string {
  if (!rango) return 'Todo';
  const corto = (ms: number) => {
    const [, m, d] = fechaIso(ms).split('-');
    return `${d}/${m}`;
  };
  // `hasta` es exclusivo: se resta un instante para nombrar el último día que
  // entra de verdad.
  const primero = corto(rango.desde);
  const ultimo = corto(rango.hasta - 1);
  return primero === ultimo ? primero : `del ${primero} al ${ultimo}`;
}
