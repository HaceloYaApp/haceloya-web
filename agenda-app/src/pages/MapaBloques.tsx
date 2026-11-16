import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import {
  MOSAICO, ZOOM_MIN, ZOOM_MAX, proyectar, desproyectar, zoomQueEntra,
  puntoDesde, MOSAICO_URL,
} from '../utils/mercator';

// EL MAPA DE LA CAMPAÑA: cuánto se mandó en cada pedazo de ciudad.
//
// El AMBA está partido en bloques del tamaño de Villa Devoto —2,53 km de lado,
// 6,42 km²— en anillos: el núcleo de 1 km alrededor de casa, y después coronas
// partidas en gajos. Cada bloque es UNA unidad de trabajo: una tanda de afiches
// y una tanda de mensajes, en el mismo lugar y en los mismos días. Por eso el
// mapa importa: el bloque que se está trabajando es también donde van los
// afiches.
//
// LOS BLOQUES SE DIBUJAN DESDE SU DEFINICIÓN, no desde polígonos guardados. Un
// bloque es "de 3,5 a 6,1 km, entre los rumbos 120° y 150°", y eso se convierte
// a esquinas acá con la fórmula del punto de destino. Guardar los polígonos
// sería guardar dos veces lo mismo, y la primera vez que cambie el tamaño del
// bloque quedarían distintos sin que nadie se entere.
//
// ES UNA FOTO, NO EL MINUTO A MINUTO. Los envíos se hacen a mano desde la
// computadora y se anotan en un CSV local; el backend no los ve. La sube
// `scripts/subir-bloques.mjs`. Por eso arriba dice de cuándo es: un mapa que
// se presenta como actual y es de hace tres días miente.
//
// Es la misma pantalla que la del celular (src/screens/panel/MapaBloques.tsx).

type Bloque = {
  nombre: string; anillo: number; gajo: number; gajos: number;
  r0: number; r1: number; desde: number; hasta: number;
  total: number; enviados: number;
};
type Datos = {
  hay: boolean;
  bloques: Bloque[];
  centro: [number, number] | null;
  lado: number;
  nucleo: number;
  enviados: number;
  total: number;
  actualizado: number | null;
};
type Camara = { lat: number; lon: number; z: number };

/** Las esquinas de un bloque, en lat/lon. Un gajo o el círculo del núcleo. */
function contorno(b: Bloque, cla: number, clo: number) {
  const pts: Array<{ lat: number; lon: number }> = [];
  if (b.gajos <= 1) {
    for (let a = 0; a < 360; a += 10) pts.push(puntoDesde(cla, clo, a, b.r1));
    return pts;
  }
  // Doce tramos por arco: a 16 km un tramo mide 130 m, menos que el grosor de
  // la línea. Con menos, los gajos de afuera se ven como triángulos.
  const paso = (b.hasta - b.desde) / 12;
  for (let i = 0; i <= 12; i++) pts.push(puntoDesde(cla, clo, b.desde + i * paso, b.r1));
  for (let i = 12; i >= 0; i--) pts.push(puntoDesde(cla, clo, b.desde + i * paso, b.r0));
  return pts;
}

function hace(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 90) return 'recién';
  const m = Math.round(s / 60);
  if (m < 90) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export default function MapaBloques() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [camara, setCamara] = useState<Camara | null>(null);
  const [caja, setCaja] = useState({ ancho: 0, alto: 420 });
  const [encima, setEncima] = useState<Bloque | null>(null);
  const cuadro = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const r = await httpsCallable(functions, 'verBloques')({});
      setDatos((r?.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo leer el mapa.'));
      setDatos(null);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  useEffect(() => {
    const el = cuadro.current;
    if (!el) return;
    const medir = () => setCaja({ ancho: el.clientWidth, alto: el.clientHeight });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [datos]);

  const centro = datos?.centro;
  const maxR = useMemo(
    () => (datos?.bloques || []).reduce((m, b) => Math.max(m, b.r1), 0),
    [datos],
  );

  // El encuadre inicial: todo el conjunto de bloques. Se recalcula sólo cuando
  // cambia el tamaño del cuadro, no en cada pintada, para no pelearse con el
  // arrastre del usuario.
  useEffect(() => {
    if (!centro || !maxR || !caja.ancho || camara) return;
    const [cla, clo] = centro;
    const n = puntoDesde(cla, clo, 0, maxR);
    const s = puntoDesde(cla, clo, 180, maxR);
    const e = puntoDesde(cla, clo, 90, maxR);
    const o = puntoDesde(cla, clo, 270, maxR);
    setCamara({
      lat: cla, lon: clo,
      z: zoomQueEntra(s.lat, n.lat, o.lon, e.lon, caja.ancho, caja.alto),
    });
  }, [centro, maxR, caja, camara]);

  const vista = useMemo(() => {
    if (!camara || !centro || !caja.ancho) return null;
    const { ancho, alto } = caja;
    const p = proyectar(camara.lat, camara.lon, camara.z);
    const origen = { x: p.x - ancho / 2, y: p.y - alto / 2 };
    const lado = 2 ** camara.z;
    const mosaicos: Array<{ x: number; y: number; left: number; top: number }> = [];
    for (let tx = Math.floor(origen.x / MOSAICO); tx <= Math.floor((origen.x + ancho) / MOSAICO); tx++) {
      for (let ty = Math.floor(origen.y / MOSAICO); ty <= Math.floor((origen.y + alto) / MOSAICO); ty++) {
        if (ty < 0 || ty >= lado) continue;
        mosaicos.push({
          x: ((tx % lado) + lado) % lado, y: ty,
          left: tx * MOSAICO - origen.x, top: ty * MOSAICO - origen.y,
        });
      }
    }
    return { origen, mosaicos, ancho, alto, z: camara.z };
  }, [camara, centro, caja]);

  const piezas = useMemo(() => {
    if (!vista || !centro || !datos) return [];
    const [cla, clo] = centro;
    return datos.bloques.map((b) => {
      const d = contorno(b, cla, clo)
        .map((q) => proyectar(q.lat, q.lon, vista.z))
        .map((q, i) => `${i ? 'L' : 'M'}${(q.x - vista.origen.x).toFixed(1)},${(q.y - vista.origen.y).toFixed(1)}`)
        .join('') + 'Z';
      const p = b.total ? Math.min(1, b.enviados / b.total) : 0;
      return { b, d, p };
    });
  }, [vista, centro, datos]);

  const arrastre = useRef<{ x: number; y: number } | null>(null);
  const empezar = (e: React.PointerEvent) => {
    arrastre.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const mover = (e: React.PointerEvent) => {
    if (!arrastre.current || !camara) return;
    const dx = e.clientX - arrastre.current.x;
    const dy = e.clientY - arrastre.current.y;
    if (!dx && !dy) return;
    arrastre.current = { x: e.clientX, y: e.clientY };
    const p = proyectar(camara.lat, camara.lon, camara.z);
    setCamara({ ...desproyectar(p.x - dx, p.y - dy, camara.z), z: camara.z });
  };
  const soltar = () => { arrastre.current = null; };
  const acercar = (d: number) => setCamara((c) => (c
    ? { ...c, z: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, c.z + d)) } : c));

  if (cargando && !datos) return <p className="admin-sub">Cargando el mapa…</p>;

  if (!datos?.hay) {
    return (
      <div className="admin-card">
        <p className="admin-sub">
          Todavía no se subió ningún mapa. Lo sube la computadora desde donde se
          manda la campaña, con <code>node scripts/subir-bloques.mjs</code>.
        </p>
        {error && <p className="admin-error-inline">{error}</p>}
      </div>
    );
  }

  const pct = datos.total ? Math.round((datos.enviados * 100) / datos.total) : 0;
  const empezados = datos.bloques.filter((b) => b.enviados > 0)
    .sort((a, b) => b.enviados - a.enviados);

  return (
    <div>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Cada gajo es un pedazo de ciudad del tamaño de Villa Devoto
        ({(datos.lado / 1000).toFixed(2)} km de lado). Cuanto más lleno, más
        gente de ahí ya recibió el mensaje. <b>Donde se está trabajando es
        donde van los afiches.</b>
      </p>

      {error && <p className="admin-error-inline">{error}</p>}

      <div className="ledger-filtros">
        <button type="button" className="ledger-chip" onClick={() => { void cargar(); }}>
          Actualizar
        </button>
        <button type="button" className="ledger-chip" onClick={() => acercar(1)}>Acercar</button>
        <button type="button" className="ledger-chip" onClick={() => acercar(-1)}>Alejar</button>
        <button type="button" className="ledger-chip" onClick={() => setCamara(null)}>
          Encuadrar todo
        </button>
      </div>

      <div
        ref={cuadro}
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        style={{
          position: 'relative', height: 420, overflow: 'hidden', borderRadius: 10,
          border: '1px solid var(--line)', background: 'var(--surface)',
          cursor: 'grab', touchAction: 'none', marginTop: 10,
        }}
      >
        {vista?.mosaicos.map((m) => (
          <img
            key={`${vista.z}-${m.x}-${m.y}`}
            src={MOSAICO_URL(vista.z, m.x, m.y)}
            alt=""
            draggable={false}
            style={{
              position: 'absolute', left: m.left, top: m.top,
              width: MOSAICO, height: MOSAICO, userSelect: 'none',
            }}
          />
        ))}
        {vista && (
          <svg
            width={vista.ancho}
            height={vista.alto}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            {piezas.map(({ b, d, p }) => (
              <path
                key={b.nombre}
                d={d}
                fill={p > 0 ? 'var(--yellow)' : 'var(--ink)'}
                fillOpacity={p > 0 ? 0.25 + p * 0.6 : 0.06}
                stroke={encima?.nombre === b.nombre ? 'var(--ink)' : 'var(--yellow-deep)'}
                strokeWidth={encima?.nombre === b.nombre ? 2.5 : 0.8}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                onPointerEnter={() => setEncima(b)}
                onPointerLeave={() => setEncima((x) => (x?.nombre === b.nombre ? null : x))}
              >
                <title>{`${b.nombre} — ${b.enviados} de ${b.total}`}</title>
              </path>
            ))}
          </svg>
        )}
        {encima && (
          <div
            style={{
              position: 'absolute', left: 10, bottom: 10, background: 'var(--card)',
              border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px',
              fontSize: 13, pointerEvents: 'none',
            }}
          >
            <b>{encima.nombre}</b>
            <div className="admin-sub">
              {encima.enviados} de {encima.total} · de {(encima.r0 / 1000).toFixed(1)} a
              {' '}{(encima.r1 / 1000).toFixed(1)} km
            </div>
          </div>
        )}
      </div>

      <p className="admin-sub" style={{ marginTop: 6 }}>
        Mapa de <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>. Arrastrá para moverte.
        {datos.actualizado
          ? ` Datos de ${hace(datos.actualizado)}.`
          : ' Sin fecha de actualización.'}
      </p>

      <div className="admin-card" style={{ marginTop: 14 }}>
        <h3>{datos.enviados} de {datos.total} mandados</h3>
        <p className="admin-sub">
          {pct}% de los {datos.bloques.length} bloques cargados.
          {' '}{empezados.length} empezado{empezados.length === 1 ? '' : 's'}.
        </p>
      </div>

      {empezados.length > 0 && (
        <ul className="admin-lista">
          {empezados.map((b) => (
            <li key={b.nombre}>
              <strong>{b.nombre}</strong>{' '}
              <strong>{b.enviados}</strong>
              <span className="admin-sub">
                {' '}de {b.total} · anillo {b.anillo} · de {(b.r0 / 1000).toFixed(1)} a
                {' '}{(b.r1 / 1000).toFixed(1)} km
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
