// La proyección del mapa y los mosaicos de OpenStreetMap, en un solo lugar.
//
// Lo usan dos pantallas —el mapa de densidad y el mapa de bloques de la
// campaña— y es la clase de código donde dos copias no se notan: las dos
// dibujan algo plausible, y la diferencia recién aparece cuando una celda y un
// bloque que tendrían que estar en la misma esquina caen a cien metros.

export const MOSAICO = 256;   // px de lado de un mosaico, fijo por el estándar
export const ZOOM_MIN = 4;
export const ZOOM_MAX = 18;
export const TIERRA_M = 40075016.686;   // la vuelta al mundo en el ecuador
export const RADIO_M = 6371000;         // radio medio de la Tierra

/** Lat/lon a píxeles del mundo entero en ese zoom (Mercator esférica). */
export function proyectar(lat: number, lon: number, z: number) {
  const n = MOSAICO * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

/** Y la vuelta: píxeles del mundo a lat/lon. Es lo que hace posible arrastrar. */
export function desproyectar(x: number, y: number, z: number) {
  const n = MOSAICO * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** El zoom más cerca posible que todavía entra todo en el cuadro. */
export function zoomQueEntra(
  minLat: number, maxLat: number, minLon: number, maxLon: number,
  ancho: number, alto: number,
) {
  for (let z = ZOOM_MAX; z > ZOOM_MIN; z--) {
    const a = proyectar(maxLat, minLon, z);
    const b = proyectar(minLat, maxLon, z);
    // 0.8 deja aire en los bordes: algo pegado al borde queda cortado al medio
    // y no se entiende si sigue para afuera.
    if (b.x - a.x <= ancho * 0.8 && b.y - a.y <= alto * 0.8) return z;
  }
  return ZOOM_MIN;
}

/**
 * A dónde se llega saliendo de un punto con ese rumbo y esa distancia.
 *
 * Es la fórmula del punto de destino sobre la esfera. Hace falta para dibujar
 * los bloques de la campaña, que están definidos en metros y grados desde una
 * casa y no por una lista de esquinas: sin esto habría que elegir entre
 * aproximarlos con una regla de tres —que a 16 km ya corre el borde cientos de
 * metros— o guardar los polígonos, que es guardar dos veces lo mismo.
 */
export function puntoDesde(lat: number, lon: number, rumboGrados: number, metros: number) {
  const d = metros / RADIO_M;
  const t = (rumboGrados * Math.PI) / 180;
  const f1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1),
                             Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: (f2 * 180) / Math.PI, lon: (l2 * 180) / Math.PI };
}

// Los mosaicos de OpenStreetMap, que no piden clave de API.
//
// CARTO ERA LA PRIMERA OPCIÓN Y NO SIRVIÓ: desde su CDN los mosaicos siguen
// devolviendo 200 y una imagen válida, pero con "API KEY REQUIRED" escrito
// encima en diagonal. O sea que probarlo con curl daba bien y sólo se vio
// abriéndolo en un navegador. Mismo aire que la trampa de la CSP.
//
// La política de uso de OSM permite esto —un panel que miran una o dos
// personas— y pide atribución, que está abajo del mapa. Lo que prohíbe es el
// uso masivo: si algún día esto lo abre mucha gente, hay que pasar a un
// proveedor con plan.
export const MOSAICO_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
