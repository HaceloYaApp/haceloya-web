import { useCallback, useEffect, useState } from 'react';
import {
  comoSeLee, fechaIso, ventanaDeLaFecha, ventanaDeLosUltimos, ventanaDelRango,
  type Ventana,
} from '../utils/diaOperativo';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import MapaDensidad from './MapaDensidad';
import './LedgerPage.css';

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

// Los mismos atajos y en el mismo orden que el registro de operaciones: "ayer"
// tiene que significar lo mismo en las dos pantallas. Las ventanas van de las
// 2:00 a las 2:00 —el día operativo— y no de medianoche a medianoche.
const ATAJOS: Array<{ key: string; label: string; ventana: () => Ventana }> = [
  { key: 'todo', label: 'Todo', ventana: () => null },
  { key: 'hoy', label: 'Hoy', ventana: () => ventanaDeLosUltimos(1) },
  {
    key: 'ayer',
    label: 'Ayer',
    ventana: () => {
      const hoy = ventanaDeLosUltimos(1);
      return { desde: hoy.desde - 86_400_000, hasta: hoy.desde };
    },
  },
  { key: '7', label: '7 días', ventana: () => ventanaDeLosUltimos(7) },
  { key: '30', label: '30 días', ventana: () => ventanaDeLosUltimos(30) },
];

type Datos = {
  total: number;
  totalHistorico: number;
  truncado: boolean;
  canales: Record<string, number>;
  nombres: Record<string, string>;
  porDia: Array<{ dia: string; total: number; canales: Record<string, number> }>;
  locales: Array<{ local: string; total: number }>;
  eventos: Array<{ id: string; canal: string; local: string | null; ms: number | null }>;
};

/** 'ferreteria-lopez' → 'Ferreteria lopez' */
function legible(local: string): string {
  const t = local.replace(/-/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Cuánto pesa una pieza sobre el total, en porcentaje entero.
 *
 * Se redondea sin decimales a propósito: con 12 escaneos, "58,3 %" finge una
 * precisión que el número no tiene. Y nunca devuelve 0 %: si la pieza trajo a
 * alguien, mostrar un cero se lee como que no trajo a nadie.
 */
function porcentaje(parte: number, total: number): string {
  if (!total || !parte) return '0 %';
  return `${Math.max(1, Math.round((parte / total) * 100))} %`;
}

/** '2026-09-21' → 'lunes 21/09'. El día de la semana va también acá. */
function diaLargo(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number);
  if (!a || !m || !d) return dia;
  // Mediodía UTC para que el cambio de huso no corra la fecha un día.
  const x = new Date(Date.UTC(a, m - 1, d, 12));
  const nombre = x.toLocaleDateString('es-AR', { timeZone: 'UTC', weekday: 'long' });
  return `${nombre} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

/**
 * 1758… → 'lunes 21/09/2026 · 14:32'. En hora de Buenos Aires, no la de la
 * máquina de quien mira.
 *
 * VA EL DÍA DE LA SEMANA Y NO SÓLO LA FECHA. Para la vía pública es la mitad
 * del dato: que un afiche junte escaneos un sábado a la tarde y otro un martes
 * a las 8 dice dos cosas distintas sobre dónde está pegado y quién pasa por
 * ahí. Con "21/09" hay que ir a buscar un calendario para saberlo.
 */
function cuando(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const z = 'America/Argentina/Buenos_Aires';
  const dia = d.toLocaleDateString('es-AR', { timeZone: z, weekday: 'long' });
  const fecha = d.toLocaleDateString('es-AR', {
    timeZone: z, day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const hora = d.toLocaleTimeString('es-AR', {
    timeZone: z, hour: '2-digit', minute: '2-digit',
  });
  return `${dia} ${fecha} · ${hora}`;
}

export default function MarketingPanel() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null = el registro de todos los QR juntos. Con un canal, sólo el de ése.
  const [filtro, setFiltro] = useState<string | null>(null);
  // La ventana de fechas manda sobre TODA la pantalla.
  const [ventana, setVentana] = useState<Ventana>(null);
  const [atajo, setAtajo] = useState('todo');
  const [desdeIso, setDesdeIso] = useState('');
  const [hastaIso, setHastaIso] = useState('');

  // EL FILTRO LO RESUELVE EL SERVIDOR, NO ESTA PANTALLA.
  //
  // Filtrar acá los 200 eventos ya cargados sería instantáneo, pero mentiría en
  // cuanto haya volumen: si una pieza tuvo escaneos más viejos que esos 200, al
  // filtrarla se verían incompletos sin que nada lo avise.
  const cargar = useCallback(async (canal?: string | null, v?: Ventana) => {
    setCargando(true);
    setError(null);
    try {
      const r = await httpsCallable(functions, 'verMarketing')({
        canal: canal || '',
        desdeMillis: v?.desde,
        hastaMillis: v?.hasta,
      });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron leer las visitas.'));
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(null, null); }, [cargar]);

  const canales = Object.entries(datos?.canales || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const mayor = canales.length ? canales[0][1] : 0;

  return (
    <>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Cuánta gente entró desde cada pieza impresa. Son escaneos de QR, no descargas:
        la cuenta se corta cuando el teléfono salta a la tienda.
      </p>

      {/* El día o el rango, igual que en el registro de operaciones. Manda sobre
          toda la pantalla: las cifras, el detalle por pieza, el registro y el
          día por día. Un filtro que sólo afectara a una parte haría que dos
          números de la misma pantalla contestaran preguntas distintas. */}
      <div className="ledger-filtros">
        {ATAJOS.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`ledger-chip${a.key === atajo ? ' ledger-chip-activo' : ''}`}
            onClick={() => {
              setAtajo(a.key);
              setDesdeIso('');
              setHastaIso('');
              const v = a.ventana();
              setVentana(v);
              void cargar(filtro, v);
            }}
          >
            {a.label}
          </button>
        ))}
        <span className="ledger-rango">
          <input
            type="date"
            aria-label="Desde"
            value={desdeIso}
            max={hastaIso || fechaIso()}
            onChange={(e) => {
              const d = e.target.value;
              setDesdeIso(d);
              setAtajo('elegido');
              // Con una sola punta cargada se muestra ESE día: esperar a que
              // estén las dos dejaría la pantalla sin responder al primer
              // cambio, como si el filtro no funcionara.
              const v = d ? (hastaIso ? ventanaDelRango(d, hastaIso) : ventanaDeLaFecha(d)) : null;
              setVentana(v);
              void cargar(filtro, v);
            }}
          />
          <span className="ledger-rango-sep">a</span>
          <input
            type="date"
            aria-label="Hasta"
            value={hastaIso}
            min={desdeIso || undefined}
            max={fechaIso()}
            onChange={(e) => {
              const h = e.target.value;
              setHastaIso(h);
              setAtajo('elegido');
              const v = desdeIso
                ? (h ? ventanaDelRango(desdeIso, h) : ventanaDeLaFecha(desdeIso))
                : (h ? ventanaDeLaFecha(h) : null);
              setVentana(v);
              void cargar(filtro, v);
            }}
          />
        </span>
        {!!ventana && <span className="ledger-rango-lectura">{comoSeLee(ventana)}</span>}
      </div>

      {error && <p className="admin-error-inline">{error}</p>}
      {cargando && !datos && <p className="admin-loading">Cargando…</p>}

      {/* El mapa va al final y no arriba: los escaneos son lo que cambia todos
          los días y el mapa se mueve de a poco. Lo de arriba es lo que se mira
          seguido. */}
      {datos && (
        <>
          <div className="admin-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{datos.total}</div>
                <div className="admin-sub">{ventana ? 'escaneos en el período' : 'escaneos en total'}</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{datos.totalHistorico}</div>
                <div className="admin-sub">desde siempre</div>
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

          {datos.truncado && (
            <p className="admin-error-inline">
              Hay más escaneos de los que se pueden leer de una. Achicá el período para
              que los números sean exactos.
            </p>
          )}

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
                      <span>
                        <strong>{n}</strong>
                        <span className="admin-sub"> · {porcentaje(n, datos.total)}</span>
                      </span>
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
              Cada escaneo con su origen, el día de la semana, la fecha y la hora, del más
              nuevo al más viejo. No se guarda nada de quien escaneó: sólo qué QR y cuándo.
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
                onClick={() => { setFiltro(null); void cargar(null, ventana); }}
              >
                Todos
              </button>
              {canales.map(([canal]) => (
                <button
                  key={canal}
                  type="button"
                  className={`btn${filtro === canal ? '' : ' btn-outline'}`}
                  onClick={() => { setFiltro(canal); void cargar(canal, ventana); }}
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
                  {/* El origen arriba y el cuándo abajo, uno debajo del otro:
                      el nombre de la pieza y la fecha completa no entran juntos
                      en una pantalla angosta sin que uno se corte. */}
                  {lista.map((e) => (
                    <li key={e.id} style={{ display: 'block' }}>
                      <div>
                        {datos.nombres?.[e.canal] || e.canal}
                        {e.local ? ` · ${legible(e.local)}` : ''}
                      </div>
                      <div className="admin-sub">{cuando(e.ms)}</div>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </div>

          {datos.porDia?.length > 0 && (
            <div className="admin-card">
              <h3>Día por día</h3>
              <p className="admin-sub">
                El total de cada día y de dónde salió. Los porcentajes son sobre ese día,
                no sobre el total de la campaña.
              </p>
              <ul className="admin-lista">
                {datos.porDia.map((d) => {
                  const delDia = Object.entries(d.canales || {})
                    .filter(([, n]) => n > 0)
                    .sort((x, y) => y[1] - x[1]);
                  return (
                    <li key={d.dia} style={{ display: 'block' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <strong>{diaLargo(d.dia)}</strong>
                        <strong>{d.total}</strong>
                      </div>
                      {delDia.map(([canal, n]) => (
                        <div
                          key={canal}
                          className="admin-sub"
                          style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                        >
                          <span>{datos.nombres?.[canal] || canal}</span>
                          <span>{n} · {porcentaje(n, d.total)}</span>
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}

      <MapaDensidad />
    </>
  );
}
