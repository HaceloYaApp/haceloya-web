import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// DE DÓNDE VIENE LA GENTE.
//
// Cada pieza impresa lleva un QR distinto que apunta a
// `haceloya.com/ir/?ref=<canal>`. Al escanearlo, esa página avisa al backend
// antes de mandar el teléfono a la tienda. Acá se ve el resultado: cuánta gente
// entró desde el afiche amarillo, cuánta desde el tótem de tal ferretería.
//
// LO QUE ESTE NÚMERO ES Y LO QUE NO ES. Son ESCANEOS, no descargas. La cadena
// se corta cuando el teléfono salta a la tienda, así que esto dice cuánta gente
// se interesó, no cuánta se instaló la app. Aun así es el número que sirve para
// decidir: es el único que compara una pieza contra otra en igualdad de
// condiciones.
//
// Es la misma pantalla que la pestaña Marketing de la app
// (src/screens/panel/Marketing.tsx). Lo que se puede hacer desde el teléfono
// tiene que poder hacerse desde la compu, y al revés.

type Datos = {
  total: number;
  canales: Record<string, number>;
  nombres: Record<string, string>;
  porDia: Array<{ dia: string; total: number }>;
  locales: Array<{ local: string; total: number }>;
  eventos: Array<{ id: string; canal: string; local: string | null; ms: number | null }>;
};

/** 'ferreteria-lopez' → 'Ferreteria lopez' */
function legible(local: string): string {
  const t = local.replace(/-/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** '2026-09-21' → '21/09' */
function diaCorto(dia: string): string {
  const [, m, d] = dia.split('-');
  return d && m ? `${d}/${m}` : dia;
}

/** 1758… → '21/09/2026 14:32'. En hora de Buenos Aires, no la de la máquina. */
function cuando(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function MarketingPanel() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = el registro de todos los QR juntos. Con un canal, sólo el de ése.
  const [filtro, setFiltro] = useState<string | null>(null);

  // EL FILTRO LO RESUELVE EL SERVIDOR, NO ESTA PANTALLA.
  //
  // Filtrar acá los 200 eventos ya cargados sería instantáneo, pero mentiría en
  // cuanto haya volumen: si una pieza tuvo escaneos más viejos que esos 200, al
  // filtrarla se verían incompletos sin que nada lo avise.
  const cargar = useCallback(async (canal?: string | null) => {
    setCargando(true);
    setError(null);
    try {
      const r = await httpsCallable(functions, 'verMarketing')({ dias: 30, canal: canal || '' });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron leer las visitas.'));
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(null); }, [cargar]);

  const canales = Object.entries(datos?.canales || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const mayor = canales.length ? canales[0][1] : 0;
  const hoy = datos?.porDia?.[0];

  return (
    <>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Cuánta gente entró desde cada pieza impresa. Son escaneos de QR, no descargas:
        la cuenta se corta cuando el teléfono salta a la tienda.
      </p>

      {error && <p className="admin-error-inline">{error}</p>}
      {cargando && !datos && <p className="admin-loading">Cargando…</p>}

      {datos && (
        <>
          <div className="admin-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{datos.total}</div>
                <div className="admin-sub">escaneos en total</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{hoy?.total ?? 0}</div>
                <div className="admin-sub">hoy</div>
              </div>
              {/* LA QUE MÁS TRAJO, y no "cuántas piezas tuvieron al menos un
                  escaneo", que es lo que decía antes. Aquel número contestaba
                  una pregunta que nadie se hace: saber que 5 de 10 piezas
                  funcionaron no dice cuál imprimir de nuevo. Éste sí. */}
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
                  {canales.length ? canales[0][1] : '—'}
                </div>
                <div className="admin-sub">
                  {canales.length
                    ? `la que más trajo: ${datos.nombres?.[canales[0][0]] || canales[0][0]}`
                    : 'todavía ninguna pieza trajo gente'}
                </div>
              </div>
            </div>
          </div>

          <div className="admin-card">
            <h3>Por pieza</h3>
            {canales.length === 0 ? (
              <p className="admin-sub">
                Todavía no hay ningún escaneo. Va a aparecer acá en cuanto alguien apunte
                el teléfono a un QR impreso.
              </p>
            ) : (
              <ul className="admin-lista">
                {canales.map(([canal, n]) => (
                  <li key={canal} style={{ display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>{datos.nombres?.[canal] || canal}</span>
                      <strong>{n}</strong>
                    </div>
                    {/* La barra se mide contra la pieza que más trajo, no contra
                        el total: lo que interesa es comparar una con otra. */}
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,.25)', marginTop: 6 }}>
                      <div style={{
                        height: 6, borderRadius: 3, background: 'var(--accent, #F2C94C)',
                        width: `${mayor ? Math.max(3, (n / mayor) * 100) : 0}%`,
                      }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {datos.locales?.length > 0 && (
            <div className="admin-card">
              <h3>Por local</h3>
              <p className="admin-sub">
                Los tótems con el nombre del comercio adentro del QR. Es el único número que
                dice a qué mostrador volver con cinco más.
              </p>
              <ul className="admin-lista">
                {datos.locales.map((l) => (
                  <li key={l.local}>
                    <span>{legible(l.local)}</span>
                    <strong>{l.total}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="admin-card">
            <h3>Registro de escaneos</h3>
            <p className="admin-sub">
              Cada escaneo con su día y su hora, del más nuevo al más viejo. No se guarda
              nada de quien escaneó: sólo qué QR y cuándo.
            </p>
            {/* LOS BOTONES SALEN DE LAS PIEZAS QUE YA TIENEN ESCANEOS, no de
                las 18 que existen: un filtro que lleva a una lista vacía no es
                un filtro. Mientras no haya ninguno quedaba sólo "Todos" y la
                pantalla parecía rota, así que ahí se explica en vez de mostrar
                el botón solo. */}
            {canales.length === 0 ? (
              <p className="admin-sub">
                Todavía no hay ningún escaneo. Cuando los haya, acá van a aparecer los
                botones para ver el registro de cada pieza por separado.
              </p>
            ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0 14px' }}>
              <button
                type="button"
                className={`btn${filtro ? ' btn-outline' : ''}`}
                onClick={() => { setFiltro(null); void cargar(null); }}
              >
                Todos
              </button>
              {canales.map(([canal]) => (
                <button
                  key={canal}
                  type="button"
                  className={`btn${filtro === canal ? '' : ' btn-outline'}`}
                  onClick={() => { setFiltro(canal); void cargar(canal); }}
                >
                  {datos.nombres?.[canal] || canal}
                </button>
              ))}
            </div>
            )}
            {(() => {
              const lista = datos.eventos || [];
              if (lista.length === 0) {
                return filtro
                  ? <p className="admin-sub">Esta pieza todavía no tuvo ningún escaneo.</p>
                  : null;
              }
              return (
                <ul className="admin-lista">
                  {lista.map((e) => (
                    <li key={e.id}>
                      <span>
                        {datos.nombres?.[e.canal] || e.canal}
                        {e.local ? ` · ${legible(e.local)}` : ''}
                      </span>
                      <span className="admin-sub">{cuando(e.ms)}</span>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>

          {datos.porDia?.length > 0 && (
            <div className="admin-card">
              <h3>Día por día</h3>
              <ul className="admin-lista">
                {datos.porDia.map((d) => (
                  <li key={d.dia}>
                    <span>{diaCorto(d.dia)}</span>
                    <strong>{d.total}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
