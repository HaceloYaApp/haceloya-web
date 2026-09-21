import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// DÓNDE ESTÁ PASANDO ALGO, POR CAPAS.
//
// Dónde está anotada la gente y dónde se publica cada cosa. No es el mapa de los
// afiches —ése lo sabe el papel— es el que sirve para decidir dónde gastar en
// publicidad y a qué barrio ir a buscar oficios.
//
// EL MAPA DE FONDO, SIN LIBRERÍA DE MAPAS. Son mosaicos de OpenStreetMap pedidos
// derecho al servidor de ellos: un mosaico es una imagen de 256x256 y la cuenta
// de dónde va cada una es la misma proyección que ya hace falta para ubicar las
// celdas. Leaflet pesaría 150 kB para esto, y arrastrar y hacer zoom sobre una
// proyección que ya está escrita son veinte líneas.
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
type Lugar = {
  nombre: string; lat: number; lon: number;
  caja: { norte: number; sur: number; este: number; oeste: number } | null;
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

// UN COLOR POR CAPA, Y NO UN DEGRADÉ DE GRISES.
//
// Una celda puede tener cosas de varias capas a la vez, así que se pinta del
// color de la que MÁS tiene: mezclar los colores daría un marrón distinto en
// cada cuadrito y no se podría leer ninguno. La cantidad se dice con la
// opacidad, que es la otra dimensión que queda libre.
//
// Los tres de "la gente" son a propósito neutros —negro y dos grises—: son el
// fondo contra el que se leen los otros seis. Si los nueve gritaran, el mapa
// sería un carnaval y no se vería lo único que importa, que es dónde se pide
// algo y no hay nadie.
const COLOR: Record<Capa, string> = {
  pedidos: '#D7263D',
  actividades: '#F46036',
  turnos: '#9B51E0',
  empleos: '#1B998B',
  ventas: '#2E86DE',
  cursos: '#E9A200',
  disponibles: '#14140F',
  aprendices: '#7A7A72',
  particulares: '#B4B4AA',
};

const ROSA = '#E5007E';   // el anillo de "acá piden y no hay nadie"

// La oferta laboral está en `piden` aunque se llame "oferta": quien publica ahí
// está buscando a alguien que trabaje, o sea que le falta una persona. Lo mismo
// que un pedido, con otro nombre.
const PIDEN: Capa[] = ['pedidos', 'actividades', 'turnos', 'empleos'];
const OFRECEN: Capa[] = ['ventas', 'cursos'];
const GENTE: Capa[] = ['disponibles', 'aprendices', 'particulares'];
const TODAS: Capa[] = [...PIDEN, ...OFRECEN, ...GENTE];

const MOSAICO = 256;   // px de lado de un mosaico, fijo por el estándar
const ZOOM_MIN = 4;
const ZOOM_MAX = 18;
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

/** Y la vuelta: píxeles del mundo a lat/lon. Es lo que hace posible arrastrar. */
function desproyectar(x: number, y: number, z: number) {
  const n = MOSAICO * 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** El zoom más cerca posible que todavía entra todo en el cuadro. */
function zoomQueEntra(
  minLat: number, maxLat: number, minLon: number, maxLon: number, ancho: number, alto: number,
) {
  for (let z = ZOOM_MAX; z > ZOOM_MIN; z--) {
    const a = proyectar(maxLat, minLon, z);
    const b = proyectar(minLat, maxLon, z);
    // 0.8 deja aire en los bordes: una celda pegada al borde queda cortada al
    // medio y no se entiende si sigue para afuera.
    if (b.x - a.x <= ancho * 0.8 && b.y - a.y <= alto * 0.8) return z;
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

type Camara = { lat: number; lon: number; z: number };

export default function MapaDensidad() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dias, setDias] = useState(90);
  const [prendidas, setPrendidas] = useState<Capa[]>(TODAS);
  // `null` = encuadrado automático sobre los datos. Se llena la primera vez que
  // se arrastra, se hace zoom o se busca una zona, y el botón "Encuadrar todo"
  // la vuelve a poner en null.
  const [camara, setCamara] = useState<Camara | null>(null);
  const [grande, setGrande] = useState(false);
  const [caja, setCaja] = useState({ ancho: 420, alto: 420 });
  const [fondoBloqueado, setFondoBloqueado] = useState(false);
  const [texto, setTexto] = useState('');
  const [lugares, setLugares] = useState<Lugar[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const arrastre = useRef<{ x: number; y: number; movido: boolean } | null>(null);

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

  // El cuadro se mide, no se fija: en pantalla completa ocupa todo y en la
  // tarjeta se achica con la ventana. Sin esto, en el celular el mapa se salía.
  useEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const medir = () => setCaja({ ancho: el.clientWidth, alto: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [grande, datos]);

  // Escape sale de pantalla completa: es lo que hace todo lo demás que se abre
  // encima de la página.
  useEffect(() => {
    if (!grande) return;
    const salir = (e: KeyboardEvent) => { if (e.key === 'Escape') setGrande(false); };
    window.addEventListener('keydown', salir);
    return () => window.removeEventListener('keydown', salir);
  }, [grande]);

  const cuenta = useCallback(
    (c: Celda, capas: Capa[]) => capas.reduce((s, k) => s + (c.n[k] || 0), 0),
    [],
  );

  const vista = useMemo(() => {
    if (!datos) return null;
    // Sólo las celdas que tienen algo de lo que está prendido: si no, quedan
    // cuadraditos invisibles empujando el encuadre hacia zonas vacías.
    const cs = datos.celdas.filter((c) => cuenta(c, prendidas) > 0);
    const { ancho, alto } = caja;
    let z: number; let centro: { lat: number; lon: number };
    if (camara) {
      z = camara.z; centro = { lat: camara.lat, lon: camara.lon };
    } else {
      const lats = cs.map((c) => c.lat), lons = cs.map((c) => c.lon);
      const minLat = cs.length ? Math.min(...lats) : -34.65, maxLat = cs.length ? Math.max(...lats) : -34.55;
      const minLon = cs.length ? Math.min(...lons) : -58.55, maxLon = cs.length ? Math.max(...lons) : -58.35;
      z = zoomQueEntra(minLat, maxLat, minLon, maxLon, ancho, alto);
      centro = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
    }
    const p = proyectar(centro.lat, centro.lon, z);
    // La esquina de arriba a la izquierda del cuadro, en píxeles del mundo:
    // todo lo demás —mosaicos y celdas— se ubica restándole esto.
    const origen = { x: p.x - ancho / 2, y: p.y - alto / 2 };

    // Los mosaicos que tocan el cuadro. En Mercator el mundo es cuadrado, así
    // que a este zoom hay 2^z de lado; el módulo es para que no se pida un
    // mosaico que no existe cerca del antimeridiano.
    const lado2z = 2 ** z;
    const mosaicos: Array<{ z: number; x: number; y: number; left: number; top: number }> = [];
    for (let tx = Math.floor(origen.x / MOSAICO); tx <= Math.floor((origen.x + ancho) / MOSAICO); tx++) {
      for (let ty = Math.floor(origen.y / MOSAICO); ty <= Math.floor((origen.y + alto) / MOSAICO); ty++) {
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
    const lado = Math.max(
      4,
      (datos.grillaMetros * MOSAICO * lado2z) / TIERRA_M / Math.cos((centro.lat * Math.PI) / 180),
    );

    return {
      cs, z, origen, lado, mosaicos, centro, ancho, alto,
      maxAct: cs.length ? Math.max(...cs.map((c) => cuenta(c, prendidas)), 1) : 1,
      punto: (c: Celda) => {
        const q = proyectar(c.lat, c.lon, z);
        return { left: q.x - origen.x, top: q.y - origen.y };
      },
    };
  }, [datos, prendidas, cuenta, camara, caja]);

  /** Mover el centro tantos píxeles de pantalla. */
  const correr = useCallback((dx: number, dy: number) => {
    if (!vista) return;
    const p = proyectar(vista.centro.lat, vista.centro.lon, vista.z);
    setCamara({ ...desproyectar(p.x - dx, p.y - dy, vista.z), z: vista.z });
  }, [vista]);

  const cambiarZoom = useCallback((paso: number) => {
    if (!vista) return;
    const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, vista.z + paso));
    if (z === vista.z) return;
    setCamara({ lat: vista.centro.lat, lon: vista.centro.lon, z });
  }, [vista]);

  // La rueda del mouse. Va como listener nativo y no como onWheel de React
  // porque React lo registra en modo pasivo: preventDefault() ahí no hace nada
  // y la página entera scrollea mientras se intenta hacer zoom en el mapa.
  useEffect(() => {
    const el = lienzo.current;
    if (!el) return;
    const rueda = (e: WheelEvent) => {
      e.preventDefault();
      cambiarZoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', rueda, { passive: false });
    return () => el.removeEventListener('wheel', rueda);
  }, [cambiarZoom]);

  const buscar = useCallback(async () => {
    if (texto.trim().length < 3) return;
    setBuscando(true);
    try {
      const r = await httpsCallable(functions, 'buscarZona')({ texto });
      setLugares(((r.data as any)?.lugares || []) as Lugar[]);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo buscar esa zona.'));
    } finally { setBuscando(false); }
  }, [texto]);

  const irA = useCallback((l: Lugar) => {
    // Con el recuadro que devuelve Google, un barrio se mira desde la altura de
    // un barrio y una esquina desde la de una esquina. Sin él habría que
    // inventar un zoom, y el mismo número está mal para los dos casos.
    const z = l.caja
      ? zoomQueEntra(l.caja.sur, l.caja.norte, l.caja.oeste, l.caja.este, caja.ancho, caja.alto)
      : 15;
    setCamara({ lat: l.lat, lon: l.lon, z });
    setLugares(null);
  }, [caja]);

  if (cargando && !datos) return <p className="admin-loading">Armando el mapa…</p>;
  if (error && !datos) return <p className="admin-error-inline">{error}</p>;
  if (!datos) return null;

  const alternar = (c: Capa) => setPrendidas((p) => (
    p.includes(c) ? p.filter((x) => x !== c) : [...p, c]
  ));
  const pidenPrendidas = PIDEN.filter((c) => prendidas.includes(c));
  const esHueco = (c: Celda) => pidenPrendidas.length > 0
    && cuenta(c, pidenPrendidas) > 0 && !(c.n.disponibles || 0);
  // Un "hueco" es una celda donde alguien pide algo de lo que está mirándose y
  // no hay ni un profesional que pueda contestarlo. Se recalcula con lo que esté
  // prendido, así que "turnos sin nadie cerca" y "pedidos sin nadie cerca" son
  // dos preguntas distintas que se contestan con los mismos datos.
  const huecos = pidenPrendidas.length > 0
    ? datos.celdas.filter(esHueco).sort((a, b) => cuenta(b, pidenPrendidas) - cuenta(a, pidenPrendidas))
    : [];
  const zonas = vista ? [...vista.cs].sort((a, b) => cuenta(b, prendidas) - cuenta(a, prendidas)) : [];
  const mapa = (c: Celda) => `https://www.google.com/maps?q=${c.lat},${c.lon}`;
  const detalle = (c: Celda) => TODAS
    .filter((k) => prendidas.includes(k) && (c.n[k] || 0) > 0)
    .map((k) => `${c.n[k]} ${NOMBRE[k].toLowerCase()}`)
    .join(' · ');
  /** La capa que más tiene esta celda: es la que le da el color. */
  const manda = (c: Celda): Capa => prendidas
    .filter((k) => (c.n[k] || 0) > 0)
    .sort((a, b) => (c.n[b] || 0) - (c.n[a] || 0))[0] || 'particulares';
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
      <span className="mapa-punto" style={{ background: COLOR[c] }} aria-hidden="true" />
      {NOMBRE[c]} <b>{datos.totales[c] ?? 0}</b>
    </button>
  );

  const elMapa = (
    <div className={grande ? 'mapa-encima' : undefined}>
      <div className="mapa-atajos">
        <button type="button" className="mapa-capa" onClick={() => cambiarZoom(-1)}>− Alejar</button>
        <button type="button" className="mapa-capa" onClick={() => cambiarZoom(1)}>+ Acercar</button>
        <button type="button" className="mapa-capa" onClick={() => setCamara(null)}>Encuadrar todo</button>
        <button type="button" className="mapa-capa" onClick={() => setGrande((g) => !g)}>
          {grande ? 'Achicar' : 'Pantalla completa'}
        </button>
        <span className="admin-sub">zoom {vista?.z ?? '—'}</span>
      </div>

      <form
        className="mapa-atajos"
        onSubmit={(e) => { e.preventDefault(); void buscar(); }}
      >
        <input
          type="search"
          className="mapa-buscador"
          placeholder="Ir a una zona: Villa Devoto, Rivadavia y Nazca…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <button type="submit" className="mapa-capa" disabled={buscando || texto.trim().length < 3}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {lugares && (
        lugares.length === 0 ? (
          <p className="admin-sub">No se encontró esa zona.</p>
        ) : (
          <ul className="admin-lista">
            {lugares.map((l) => (
              <li key={`${l.lat},${l.lon}`}>
                <button type="button" className="mapa-resultado" onClick={() => irA(l)}>{l.nombre}</button>
              </li>
            ))}
          </ul>
        )
      )}

      <div
        ref={lienzo}
        className="mapa-lienzo"
        onPointerDown={(e) => {
          arrastre.current = { x: e.clientX, y: e.clientY, movido: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const a = arrastre.current;
          if (!a) return;
          const dx = e.clientX - a.x, dy = e.clientY - a.y;
          if (!a.movido && Math.abs(dx) + Math.abs(dy) < 4) return;
          a.movido = true; a.x = e.clientX; a.y = e.clientY;
          correr(dx, dy);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          // Se limpia en el próximo cuadro: el click de la celda llega DESPUÉS
          // del pointerup, y sin esto arrastrar sobre una celda abriría Google
          // Maps al soltar.
          const movido = arrastre.current?.movido;
          arrastre.current = null;
          if (movido) { const t = e.currentTarget; t.dataset.arrastrado = '1'; setTimeout(() => { delete t.dataset.arrastrado; }, 0); }
        }}
      >
        {vista?.mosaicos.map((m) => (
          <img
            key={`${m.z}/${m.x}/${m.y}`}
            src={MOSAICO_URL(m.z, m.x, m.y)}
            alt=""
            width={MOSAICO}
            height={MOSAICO}
            draggable={false}
            onError={() => setFondoBloqueado(true)}
            style={{ position: 'absolute', left: m.left, top: m.top }}
          />
        ))}
        {vista?.cs.map((c) => {
          const { left, top } = vista.punto(c);
          const hueco = esHueco(c);
          const fuerza = Math.min(1, cuenta(c, prendidas) / vista.maxAct);
          return (
            <a
              key={`${c.lat},${c.lon}`}
              href={mapa(c)}
              target="_blank"
              rel="noreferrer"
              title={detalle(c)}
              draggable={false}
              onClick={(e) => {
                if (lienzo.current?.dataset.arrastrado) e.preventDefault();
              }}
              style={{
                position: 'absolute',
                left: left - vista.lado / 2, top: top - vista.lado / 2,
                width: vista.lado, height: vista.lado, borderRadius: 2,
                background: COLOR[manda(c)],
                // El anillo rosa se superpone al color de la capa en vez de
                // reemplazarlo: así una celda dice las dos cosas a la vez —qué
                // se pide ahí, y que no hay nadie para hacerlo.
                boxShadow: hueco ? `0 0 0 2px ${ROSA}` : 'none',
                opacity: 0.45 + fuerza * 0.5,
              }}
            />
          );
        })}
      </div>

      <p className="admin-sub" style={{ marginTop: 8 }}>
        Arrastrá para moverte, rueda del mouse para el zoom. Tocá una celda para abrir esa
        esquina en Google Maps. Mapa ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>{' '}
        y sus colaboradores.
      </p>

      {fondoBloqueado && (
        <p className="admin-error-inline" style={{ marginTop: 8 }}>
          El mapa de fondo está bloqueado por la CSP del sitio. En Cloudflare, en la
          cabecera Content-Security-Policy, agregá <code>https://tile.openstreetmap.org</code>{' '}
          a <code>img-src</code>. Las celdas se siguen viendo igual mientras tanto.
        </p>
      )}
    </div>
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
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: ROSA }}>{huecos.length}</div>
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

        <div className="mapa-referencias">
          {TODAS.filter((k) => prendidas.includes(k)).map((k) => (
            <span key={k} className="mapa-referencia">
              <span className="mapa-muestra" style={{ background: COLOR[k] }} aria-hidden="true" />
              {NOMBRE[k]}
            </span>
          ))}
          {pidenPrendidas.length > 0 && (
            <span className="mapa-referencia">
              <span
                className="mapa-muestra"
                style={{ background: '#FFFFFF', boxShadow: `0 0 0 2px ${ROSA}` }}
                aria-hidden="true"
              />
              Piden y no hay nadie
            </span>
          )}
          <span className="mapa-referencia">
            <span className="mapa-muestra mapa-muestra-flojo" aria-hidden="true" />
            <span className="mapa-muestra" style={{ background: '#14140F' }} aria-hidden="true" />
            Más fuerte, más movimiento
          </span>
        </div>

        <p className="admin-sub" style={{ marginTop: 10 }}>
          Cada cuadrito es una celda de {datos.grillaMetros} m y se pinta del color de la
          capa que más tiene ahí. La cantidad la dice lo fuerte que está: mezclar los
          colores daría un marrón distinto en cada cuadrito y no se leería ninguno.
        </p>

        {!vista || vista.cs.length === 0 ? (
          <>
            <p className="admin-sub">
              No hay ninguna celda con lo que está prendido, pero el mapa sigue andando:
              movelo o buscá una zona para reconocer dónde vas a pegar.
            </p>
            {elMapa}
          </>
        ) : elMapa}
      </div>

      {pidenPrendidas.length > 0 && (
        <div className="admin-card">
          <h3>Piden {nombresDe(pidenPrendidas)} y no hay nadie cerca</h3>
          <p className="admin-sub">
            Zonas donde alguien publicó algo de eso y no hay ningún profesional disponible
            anotado. Es lo más caro que le puede pasar a la app: el que publica y no recibe
            ni un presupuesto no vuelve, y encima lo cuenta. Cada una de éstas es una mañana
            de ronda con destino.
          </p>
          {huecos.length === 0 ? (
            <p className="admin-sub">Ninguna: en todas las zonas donde se pidió algo hay alguien anotado.</p>
          ) : (
            <ul className="admin-lista">
              {huecos.slice(0, 15).map((c) => (
                <li key={`h${c.lat},${c.lon}`}>
                  <button
                    type="button"
                    className="mapa-resultado"
                    onClick={() => setCamara({ lat: c.lat, lon: c.lon, z: 15 })}
                  >
                    {c.lat.toFixed(4)}, {c.lon.toFixed(4)} — llevar el mapa acá
                  </button>
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
                <button
                  type="button"
                  className="mapa-resultado"
                  onClick={() => setCamara({ lat: c.lat, lon: c.lon, z: 15 })}
                >
                  {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
                </button>
                <span className="admin-sub">{detalle(c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
