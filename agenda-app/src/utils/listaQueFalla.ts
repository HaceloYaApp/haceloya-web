// ---------------------------------------------------------------------------
// "NO PUDIMOS LEER" NO ES "NO HAY NADA" (10/09/2026).
//
// Es el mismo módulo que la app de celular (src/utils/listaQueFalla.ts), traído
// acá porque el panel web tiene el mismo defecto en seis lugares.
//
// Una consulta falla, el manejador vacía la lista, y la pantalla AFIRMA que no
// hay nada. Falla exactamente igual que cuando funciona, así que nadie se
// entera. En la app ya costó caro cuatro veces —el moderador mirando un chat
// vacío, un curso "sin inscriptos" que estaba lleno, un profesional "sin
// reseñas" con veinte, y "todavía no hiciste ningún pago" a alguien que acababa
// de pagar—.
//
// Acá los dos peores son:
//   · el registro de accesos, que decía "nadie tocó esa cuenta" cuando la
//     lectura falló — o sea lo contrario del control que promete la política de
//     privacidad;
//   · la conversación de un arrepentimiento, que se tragaba el error entero y
//     decía "todavía no se escribieron mensajes" habiendo mensajes. Una
//     revocación del art. 34 tiene reloj de 24 horas.
// ---------------------------------------------------------------------------

/**
 * El texto de una lista vacía, que depende de POR QUÉ está vacía.
 *
 * @param noSePudoLeer si la última lectura falló
 * @param cuandoNoHayNada lo que se dice cuando de verdad no hay nada
 * @param queNoSePudoLeer opcional, para decir QUÉ no se pudo leer
 * @returns el texto a mostrar
 */
export function textoDeListaVacia(
  noSePudoLeer: boolean,
  cuandoNoHayNada: string,
  queNoSePudoLeer?: string,
): string {
  if (!noSePudoLeer) return cuandoNoHayNada;
  return queNoSePudoLeer ?
    `No pudimos leer ${queNoSePudoLeer}. Revisá tu conexión y volvé a entrar.` :
    'No pudimos leer esto. Revisá tu conexión y volvé a entrar.';
}
