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
// SIN MAPA DE FONDO, Y ES A PROPÓSITO. Poner calles pediría cargar mosaicos de
// un servidor de terceros, y la CSP del sitio no lo permite (`img-src 'self'`):
// habría que abrirla para que un tercero vea desde qué zonas mira el panel un
// administrador. Las celdas solas igual muestran la forma de lo que hay —se
// reconoce la mancha de la ciudad— y para ubicar una zona puntual está el link
// que abre ese punto en Google Maps, que es más preciso que mirar un dibujito.
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

const LADO = 420;   // px del cuadro donde se dibuja

export default function MapaDensidad() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dias, setDias] = useState(90);
  const [prendidas, setPrendidas] = useState<Capa[]>(TODAS);

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
    const minLat = cs.length ? Math.min(...lats) : 0, maxLat = cs.length ? Math.max(...lats) : 0;
    const minLon = cs.length ? Math.min(...lons) : 0, maxLon = cs.length ? Math.max(...lons) : 0;
    // Un margen para que las celdas del borde no queden cortadas al medio, y la
    // escala la manda el lado más grande: así no se deforma la ciudad.
    const span = Math.max(
      Math.max(maxLat - minLat, 0.01) * 1.1,
      Math.max(maxLon - minLon, 0.01) * 1.1,
    );
    const cx = (minLat + maxLat) / 2, cy = (minLon + maxLon) / 2;
    return {
      cs,
      span, cx, cy,
      maxAct: cs.length ? Math.max(...cs.map((c) => cuenta(c, prendidas)), 1) : 1,
      lado: Math.max(3, (datos.grillaMetros / 111_320 / span) * LADO),
    };
  }, [datos, prendidas, cuenta]);

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
        <h3>El dibujo</h3>
        <p className="admin-sub">
          Sin calles de fondo a propósito: los mosaicos de un mapa los sirve un tercero y la
          CSP del sitio no lo permite. Cada cuadrito es una celda de {datos.grillaMetros} m;
          cuanto más fuerte, más movimiento de lo que esté prendido.
          {pidenPrendidas.length > 0 && (
            <>
              {' '}Los <b style={{ color: '#E5007E' }}>rosas</b> son zonas donde se pide algo
              y no hay ningún profesional disponible.
            </>
          )}
        </p>
        {!vista || vista.cs.length === 0 ? (
          <p className="admin-sub">
            No hay ninguna celda con lo que está prendido. Probá con otra capa o con una
            ventana de días más larga.
          </p>
        ) : (
          <>
            <div style={{
              position: 'relative', width: LADO, height: LADO, maxWidth: '100%',
              border: '1px solid var(--borde, #ccc)', borderRadius: 4, marginTop: 12,
              overflow: 'hidden',
            }}
            >
              {vista.cs.map((c) => {
                // La latitud crece hacia arriba y la pantalla hacia abajo: por eso va al revés.
                const top = ((vista.cx + vista.span / 2 - c.lat) / vista.span) * LADO;
                const left = ((c.lon - (vista.cy - vista.span / 2)) / vista.span) * LADO;
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
                      top: top - vista.lado / 2, left: left - vista.lado / 2,
                      width: vista.lado, height: vista.lado, borderRadius: 1,
                      background: hueco ? '#E5007E' : 'currentColor',
                      opacity: hueco ? 0.9 : 0.25 + fuerza * 0.65,
                    }}
                  />
                );
              })}
            </div>
            <p className="admin-sub" style={{ marginTop: 8 }}>
              Tocá un cuadrito para abrir esa zona en Google Maps.
            </p>
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
