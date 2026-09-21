import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// DÓNDE ESTÁ PASANDO ALGO, POR CAPAS.
//
// Dónde está anotada la gente y dónde se publica cada cosa. No es el mapa de los
// afiches —ése lo sabe el papel— es el que sirve para decidir dónde gastar en
// publicidad y a qué barrio ir a buscar oficios.
//
// EL MAPA DE FONDO. Son mosaicos de OpenStreetMap pedidos derecho al servidor
// de ellos: no hace falta ninguna librería de mapas, un
// mosaico es una imagen de 256x256 y la cuenta de dónde va cada una es la misma
// proyección que ya se necesita para poner las celdas. Leaflet pesaría 150 kB
// para eso.
//
// HAY QUE DEJARLO PASAR EN LA CSP: `img-src` tiene que incluir
// https://tile.openstreetmap.org, y esa cabecera la pone Cloudflare, no este
// repo. Mientras no esté, las imágenes se bloquean y abajo aparece el aviso que
// dice exactamente qué agregar — un mapa en blanco sin explicación es lo que
// hizo falta averiguar a mano la primera vez.
//
// PROYECCIÓN DE VERDAD, NO UNA REGLA DE TRES. Antes las celdas se ubicaban
// repartiendo lat y lon por igual sobre el cuadro, y a la latitud de Buenos
// Aires un grado de longitud mide 0,82 de uno de latitud: el dibujo salía
// estirado. Ahora va en Mercator, que es lo que usan los mosaicos, así que las
// celdas caen sobre la calle que les toca.
//
// LAS CAPAS SE PRENDEN Y SE APAGAN SIN VOLVER A PREGUNTAR AL SERVIDOR. El
// callable trae los conteos de todas las capas por celda de una sola vez, así
// que cruzar "turnos contra profesionales" es instantáneo y no cuesta ni una
// lectura más de Firestore. Son nueve capas: si cada una fuera una consulta
// aparte, jugar con los botones saldría plata.

type Capa =
  | 'pedidos' | 'actividades' | 'turnos' | 'empleos'
  | 'ventas' | 'cursos'
  | 'disponibles' | 'aprendices' | 'particulares';

type Celda = { lat: number; lon: number; n: Partial<Record<Capa, number>> };
type Datos = {
  celdas: Celda[];
  grillaMetros: number;
  dias: number;
  truncado: boolean;
  zonas: number;
  totales: Record<Capa, number>;
  sinUbicacion: Record<Capa, number>;
};

const NOMBRE: Record<Capa, string> = {
  pedidos: 'Pedidos',
  actividades: 'Actividades',
  turnos: 'Turnos',
  empleos: 'Oferta laboral',
  ventas: 'Ventas (Market)',
  cursos: 'Cursos',
  disponibles: 'Profesionales disponibles',
  aprendices: 'Aprendices y ayudantes',
  particulares: 'Particulares',
};

// Las tres familias. `piden` es la demanda —lo que alguien necesita y todavía no
// tiene—; `ofrecen` es lo que ya está publicado para dar; `gente` es el padrón.
//
// La oferta laboral está en `piden` aunque se llame "oferta": quien publica ahí
// está buscando a alguien que trabaje, o sea que le falta una persona. Lo mismo
// que un pedido, con otro nombre.
const PIDEN: Capa[] = ['pedidos', 'actividades', 'turnos', 'empleos'];
const OFRECEN: Capa[] = ['ventas', 'cursos'];
const GENTE: Capa[] = ['disponibles', 'aprendices', 'particulares'];
const TODAS: Capa[] = [...PIDEN, ...OFRECEN, ...GENTE];

const LADO = 420;      // px del cuadro donde se dibuja
const MOSAICO = 256;   // px de lado de un mosaico, fijo por el estándar
const ZOOM_MIN = 4;
const ZOOM_MAX = 16;
const TIERRA_M = 40075016.686;   // la vuelta al mundo en el ecuador

/** Lat/lon a píxeles del mundo entero en ese zoom (Mercator esférica). */
function proyectar(lat: number, lon: number, z: number) {
  const n = MOSAICO * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
}

/** El zoom más cerca posible que todavía entra todo en el cuadro. */
function zoomQueEntra(minLat: number, maxLat: number, minLon: number, maxLon: number) {
  for (let z = ZOOM_MAX; z > ZOOM_MIN; z--) {
    const a = proyectar(maxLat, minLon, z);
    const b = proyectar(minLat, maxLon, z);
    // 0.8 deja aire en los bordes: una celda pegada al borde queda cortada al
    // medio y no se entiende si sigue para afuera.
    if (b.x - a.x <= LADO * 0.8 && b.y - a.y <= LADO * 0.8) return z;
  }
  return ZOOM_MIN;
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
const MOSAICO_URL = (z: number, x: number, y: number) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

export default function MapaDensidad() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dias, setDias] = useState(90);
  const [prendidas, setPrendidas] = useState<Capa[]>(TODAS);
  const [acercar, setAcercar] = useState(0);
  // Si el primer mosaico no carga, casi seguro es la CSP: se avisa con la
  // línea exacta que hay que agregar, en vez de dejar un cuadro en blanco.
  const [fondoBloqueado, setFondoBloqueado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await httpsCallable(functions, 'verMapaDeDensidad')({ dias });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo armar el mapa.'));
      setDatos(null);
    } finally { setCargando(false); }
  }, [dias]);

  useEffect(() => { void cargar(); }, [cargar]);

  const alternar = (c: Capa) => setPrendidas((p) => (
    p.includes(c) ? p.filter((x) => x !== c) : [...p, c]
  ));

  const cuenta = useCallback(
    (c: Celda, capas: Capa[]) => capas.reduce((s, k) => s + (c.n[k] || 0), 0),
    [],
  );

  const vista = useMemo(() => {
    if (!datos) return null;
    // Sólo las celdas que tienen algo de lo que está prendido: si no, quedan
    // cuadraditos invisibles empujando el encuadre hacia zonas vacías.
    const cs = datos.celdas.filter((c) => cuenta(c, prendidas) > 0);
    const lats = cs.map((c) => c.lat), lons = cs.map((c) => c.lon);
    const minLat = cs.length ? Math.min(...lats) : -34.65, maxLat = cs.length ? Math.max(...lats) : -34.55;
    const minLon = cs.length ? Math.min(...lons) : -58.55, maxLon = cs.length ? Math.max(...lons) : -58.35;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomQueEntra(minLat, maxLat, minLon, maxLon) + acercar));
    const centro = proyectar((minLat + maxLat) / 2, (minLon + maxLon) / 2, z);
    // La esquina de arriba a la izquierda del cuadro, en píxeles del mundo:
    // todo lo demás —mosaicos y celdas— se ubica restándole esto.
    const origen = { x: centro.x - LADO / 2, y: centro.y - LADO / 2 };

    // Los mosaicos que tocan el cuadro. En Mercator el mundo es cuadrado, así
    // que a este zoom hay 2^z de lado; el módulo es para que no se pida un
    // mosaico que no existe cerca del antimeridiano.
    const lado2z = 2 ** z;
    const mosaicos: Array<{ z: number; x: number; y: number; left: number; top: number }> = [];
    for (let tx = Math.floor(origen.x / MOSAICO); tx <= Math.floor((origen.x + LADO) / MOSAICO); tx++) {
      for (let ty = Math.floor(origen.y / MOSAICO); ty <= Math.floor((origen.y + LADO) / MOSAICO); ty++) {
        if (ty < 0 || ty >= lado2z) continue;
        mosaicos.push({
          z,
          x: ((tx % lado2z) + lado2z) % lado2z,
          y: ty,
          left: tx * MOSAICO - origen.x,
          top: ty * MOSAICO - origen.y,
        });
      }
    }

    // El lado de una celda de la grilla, en píxeles de este zoom. En Mercator la
    // escala se estira con la latitud, así que hay que dividir por el coseno —
    // si no, a la altura de Buenos Aires las celdas salen 18% chicas y dejan
    // huecos blancos entre una y otra.
    const latMedia = (minLat + maxLat) / 2;
    const lado = Math.max(
      3,
      (datos.grillaMetros * MOSAICO * lado2z) / TIERRA_M / Math.cos((latMedia * Math.PI) / 180),
    );

    return {
      cs, z, origen, lado, mosaicos,
      maxAct: cs.length ? Math.max(...cs.map((c) => cuenta(c, prendidas)), 1) : 1,
      punto: (c: Celda) => {
        const q = proyectar(c.lat, c.lon, z);
        return { left: q.x - origen.x, top: q.y - origen.y };
      },
    };
  }, [datos, prendidas, cuenta, acercar]);

  if (cargando && !datos) return <p className="admin-loading">Armando el mapa…</p>;
  if (error) return <p className="admin-error-inline">{error}</p>;
  if (!datos) return null;

  const pidenPrendidas = PIDEN.filter((c) => prendidas.includes(c));
  const proPrendido = prendidas.includes('disponibles');
  // Un "hueco" es una celda donde alguien pide algo de lo que está mirándose y
  // no hay ni un profesional que pueda contestarlo. Se recalcula con lo que esté
  // prendido, así que "turnos sin nadie" y "pedidos sin nadie" son dos preguntas
  // distintas que se contestan con los mismos datos.
  const huecos = pidenPrendidas.length > 0
    ? datos.celdas
      .filter((c) => cuenta(c, pidenPrendidas) > 0 && !(c.n.disponibles || 0))
      .sort((a, b) => cuenta(b, pidenPrendidas) - cuenta(a, pidenPrendidas))
    : [];
  const zonas = vista?.cs ? [...vista.cs].sort((a, b) => cuenta(b, prendidas) - cuenta(a, prendidas)) : [];
  const mapa = (c: Celda) => `https://www.google.com/maps?q=${c.lat},${c.lon}`;
  const detalle = (c: Celda) => TODAS
    .filter((k) => prendidas.includes(k) && (c.n[k] || 0) > 0)
    .map((k) => `${c.n[k]} ${NOMBRE[k].toLowerCase()}`)
    .join(' · ');
  const suma = (capas: Capa[]) => capas.reduce((s, k) => s + (datos.totales[k] || 0), 0);
  const nombresDe = (capas: Capa[]) => capas.map((k) => NOMBRE[k].toLowerCase()).join(', ');

  const boton = (c: Capa) => (
    <button
      key={c}
      type="button"
      className={`mapa-capa${prendidas.includes(c) ? ' mapa-capa-activa' : ''}`}
      onClick={() => alternar(c)}
      aria-pressed={prendidas.includes(c)}
    >
      {NOMBRE[c]} <b>{datos.totales[c] ?? 0}</b>
    </button>
  );

  return (
    <>
      <div className="admin-card">
        <h3>Dónde está pasando algo</h3>
        <p className="admin-sub">
          Todo lo que tiene una ubicación adentro de la app, sobre la grilla de{' '}
          {datos.grillaMetros} m. Es el mapa que sirve para decidir dónde poner publicidad
          y a qué barrio ir a buscar oficios. Prendé y apagá capas para cruzarlas: lo que
          se pide contra quién hay para hacerlo.
        </p>

        <div className="mapa-familias">
          <div>
            <div className="mapa-familia-titulo">Lo que piden</div>
            <div className="mapa-capas">{PIDEN.map(boton)}</div>
          </div>
          <div>
            <div className="mapa-familia-titulo">Lo que ofrecen</div>
            <div className="mapa-capas">{OFRECEN.map(boton)}</div>
          </div>
          <div>
            <div className="mapa-familia-titulo">La gente anotada</div>
            <div className="mapa-capas">{GENTE.map(boton)}</div>
          </div>
        </div>

        <div className="mapa-atajos">
          <button type="button" className="mapa-capa" onClick={() => setPrendidas(TODAS)}>Todo</button>
          <button type="button" className="mapa-capa" onClick={() => setPrendidas(PIDEN)}>Sólo lo que piden</button>
          <button type="button" className="mapa-capa" onClick={() => setPrendidas(OFRECEN)}>Sólo lo que ofrecen</button>
          <button type="button" className="mapa-capa" onClick={() => setPrendidas(['disponibles'])}>Sólo profesionales</button>
          <button type="button" className="mapa-capa" onClick={() => setPrendidas([...PIDEN, 'disponibles'])}>Piden vs. profesionales</button>
          <span className="admin-sub" style={{ marginLeft: 'auto' }}>
            Publicado en los últimos{' '}
            <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              <option value={7}>7 días</option>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
              <option value={180}>180 días</option>
              <option value={365}>365 días</option>
            </select>
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, marginTop: 16 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{suma(PIDEN)}</div>
            <div className="admin-sub">cosas que se pidieron</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{suma(OFRECEN)}</div>
            <div className="admin-sub">cosas publicadas para dar</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{datos.totales.disponibles}</div>
            <div className="admin-sub">profesionales disponibles</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{vista?.cs.length ?? 0}</div>
            <div className="admin-sub">zonas con algo prendido</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: '#E5007E' }}>{huecos.length}</div>
            <div className="admin-sub">zonas que piden y sin nadie</div>
          </div>
        </div>

        <p className="admin-sub" style={{ marginTop: 12 }}>
          Las cuentas y las publicaciones sin dirección cargada no entran en el mapa:{' '}
          {TODAS.filter((k) => (datos.sinUbicacion[k] || 0) > 0)
            .map((k) => `${datos.sinUbicacion[k]} ${NOMBRE[k].toLowerCase()}`)
            .join(', ') || 'ninguna, están todas ubicadas'}.
          {datos.truncado && ' El mapa está recortado: hay más de 5000 documentos en alguna capa.'}
        </p>
      </div>

      <div className="admin-card">
        <h3>El mapa</h3>
        <p className="admin-sub">
          Cada cuadrito es una celda de {datos.grillaMetros} m; cuanto más fuerte, más
          movimiento de lo que esté prendido.
          {pidenPrendidas.length > 0 && (
            <>
              {' '}Los <b style={{ color: '#E5007E' }}>rosas</b> son zonas donde se pide algo
              y no hay ningún profesional disponible.
            </>
          )}
          {' '}Tocá uno para abrir esa esquina en Google Maps.
        </p>

        {!vista || vista.cs.length === 0 ? (
          <p className="admin-sub">
            No hay ninguna celda con lo que está prendido. Probá con otra capa o con una
            ventana de días más larga.
          </p>
        ) : (
          <>
            <div className="mapa-atajos" style={{ marginTop: 10 }}>
              <button type="button" className="mapa-capa" onClick={() => setAcercar((a) => a - 1)}>− Alejar</button>
              <button type="button" className="mapa-capa" onClick={() => setAcercar((a) => a + 1)}>+ Acercar</button>
              {acercar !== 0 && (
                <button type="button" className="mapa-capa" onClick={() => setAcercar(0)}>Encuadrar todo</button>
              )}
              <span className="admin-sub">zoom {vista.z}</span>
            </div>

            <div style={{
              position: 'relative', width: LADO, height: LADO, maxWidth: '100%',
              border: '1px solid var(--borde, #ccc)', borderRadius: 6, marginTop: 10,
              overflow: 'hidden', background: '#EAEAEA',
            }}
            >
              {vista.mosaicos.map((m) => (
                <img
                  key={`${m.z}/${m.x}/${m.y}`}
                  src={MOSAICO_URL(m.z, m.x, m.y)}
                  alt=""
                  width={MOSAICO}
                  height={MOSAICO}
                  draggable={false}
                  onError={() => setFondoBloqueado(true)}
                  style={{ position: 'absolute', left: m.left, top: m.top, userSelect: 'none' }}
                />
              ))}
              {vista.cs.map((c) => {
                const { left, top } = vista.punto(c);
                const hueco = pidenPrendidas.length > 0
                  && cuenta(c, pidenPrendidas) > 0 && !(c.n.disponibles || 0);
                const fuerza = Math.min(1, cuenta(c, prendidas) / vista.maxAct);
                return (
                  <a
                    key={`${c.lat},${c.lon}`}
                    href={mapa(c)}
                    target="_blank"
                    rel="noreferrer"
                    title={detalle(c)}
                    style={{
                      position: 'absolute',
                      left: left - vista.lado / 2, top: top - vista.lado / 2,
                      width: vista.lado, height: vista.lado, borderRadius: 2,
                      // Encima del mapa el relleno solo se confunde con el gris
                      // de las manzanas: el borde es lo que hace que una celda
                      // con poco movimiento igual se vea.
                      background: hueco ? '#E5007E' : '#14140F',
                      border: `1px solid ${hueco ? '#8A004C' : '#FFFFFF'}`,
                      opacity: hueco ? 0.85 : 0.3 + fuerza * 0.55,
                    }}
                  />
                );
              })}
            </div>

            <p className="admin-sub" style={{ marginTop: 8 }}>
              Mapa © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>{' '}
              y sus colaboradores.
            </p>

            {fondoBloqueado && (
              <p className="admin-error-inline" style={{ marginTop: 8 }}>
                El mapa de fondo está bloqueado por la CSP del sitio. En Cloudflare, en la
                cabecera Content-Security-Policy, agregá{' '}
                <code>https://tile.openstreetmap.org</code> a <code>img-src</code>. Las
                celdas se siguen viendo igual mientras tanto.
              </p>
            )}
          </>
        )}
      </div>

      {pidenPrendidas.length > 0 && (
        <div className="admin-card">
          <h3>Piden {nombresDe(pidenPrendidas)} y no hay nadie cerca</h3>
          <p className="admin-sub">
            Zonas donde alguien publicó algo de eso y no hay ningún profesional disponible
            anotado. Es lo más caro que le puede pasar a la app: el que publica y no recibe
            ni un presupuesto no vuelve, y encima lo cuenta. Cada una de éstas es una mañana
            de ronda con destino.
            {!proPrendido && ' (La capa de profesionales está apagada, pero esta lista igual los mira: si no, no querría decir nada.)'}
          </p>
          {huecos.length === 0 ? (
            <p className="admin-sub">Ninguna: en todas las zonas donde se pidió algo hay alguien anotado.</p>
          ) : (
            <ul className="admin-lista">
              {huecos.slice(0, 15).map((c) => (
                <li key={`h${c.lat},${c.lon}`}>
                  <a href={mapa(c)} target="_blank" rel="noreferrer">
                    {c.lat.toFixed(4)}, {c.lon.toFixed(4)} — ver en el mapa
                  </a>
                  <strong>{cuenta(c, pidenPrendidas)} sin respuesta</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {zonas.length > 0 && (
        <div className="admin-card">
          <h3>Las zonas con más movimiento</h3>
          <p className="admin-sub">Con las capas que estén prendidas.</p>
          <ul className="admin-lista">
            {zonas.slice(0, 15).map((c) => (
              <li key={`z${c.lat},${c.lon}`}>
                <a href={mapa(c)} target="_blank" rel="noreferrer">
                  {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
                </a>
                <span className="admin-sub">{detalle(c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
