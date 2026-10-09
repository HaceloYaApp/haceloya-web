import { useCallback, useEffect, useRef, useState } from 'react';
import {
  comoSeLee, fechaIso, ventanaDeLaFecha, ventanaDeLosUltimos, ventanaDelRango,
  type Ventana,
} from '../utils/diaOperativo';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import MapaDensidad from './MapaDensidad';
import QueFalta from './QueFalta';
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
  porHora: number[];
  sistemas: Record<string, number>;
  sistemaPorCanal: Record<string, Record<string, number>>;
  grupos: Array<{ titulo: string; canales: string[] }>;
  porHoraSinFranja: number[];
  franja: { desde: number; hasta: number } | null;
  locales: Array<{ local: string; total: number }>;
  eventos: Array<{ id: string; canal: string; local: string | null; sistema?: string; ms: number | null }>;
  // Cuántos escaneos hay en la ventana, aunque hayan viajado menos: es lo que
  // deja decir "mostrando 50 de 1.312" en vez de mentir con el largo de la lista.
  eventosEnLaVentana?: number;
};

const HORAS = Array.from({ length: 24 }, (_, i) => i);

/**
 * { android: 41, ios: 8 } → 'Android 41 · iPhone 8'
 *
 * Los ceros no se escriben: "iPhone 0" ocupa lugar para decir nada. Y 'otro'
 * sólo aparece si hay alguno — son escaneos de escritorio, o de antes del
 * 29/09, cuando todavía no se guardaba el sistema.
 */
function reparto(m: Record<string, number> | undefined): string {
  if (!m) return '';
  const nombres: Record<string, string> = { android: 'Android', ios: 'iPhone', otro: 'otro' };
  return ['android', 'ios', 'otro']
    .filter((k) => (m[k] || 0) > 0)
    .map((k) => `${nombres[k]} ${m[k]}`)
    .join(' · ');
}

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
    // `hourCycle: 'h23'` no es decoración: es-AR resuelve a reloj de 12 horas,
    // así que sin esto un escaneo de las 21:30 se lee "09:30 p. m." — que acá
    // nadie escribe, y que a un ojo apurado se le parece a las nueve y media de
    // la mañana. El resto del panel dice las horas en 24.
    timeZone: z, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return `${dia} ${fecha} · ${hora}`;
}

const SOLAPAS = [
  { key: 'escaneos' as const, label: 'Escaneos' },
  { key: 'registro' as const, label: 'Registro' },
  { key: 'mapa' as const, label: 'Dónde pasa algo' },
  { key: 'falta' as const, label: 'Qué falta' },
];

type Solapa = (typeof SOLAPAS)[number]['key'];

/**
 * Qué NO se borra al limpiar, por más que esté en el archivo.
 *
 * Todo lo que dibuja esta pestaña —el total del período, el detalle por pieza,
 * a qué hora escanean, el día por día— se calcula de los eventos, no de los
 * contadores. Borrar los de ayer deja la pantalla en cero para ayer.
 */
const CONSERVAR_DIAS = 90;

/** Cuántos escaneos trae el registro cerrado, y cuántos al expandirlo. */
const MINIMIZADO = 50;
const EXPANDIDO = 2000;

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
  // La franja horaria, las dos puntas incluidas. 0 y 23 es "todas".
  const [horaDesde, setHoraDesde] = useState(0);
  const [horaHasta, setHoraHasta] = useState(23);

  // LAS DOS SOLAPAS.
  //
  // Son dos preguntas distintas que estaban una abajo de la otra en el mismo
  // scroll: "de qué pieza vino la gente" y "en qué zonas está pasando algo".
  // El filtro de día y de hora manda sobre la primera y no tiene nada que ver
  // con la segunda, así que verlas pegadas invitaba a leer el mapa como si
  // también estuviera filtrado. Son de segundo nivel —adentro de Marketing—,
  // por eso chips y no pestañas, igual que las solapas de Moderación.
  const [solapa, setSolapa] = useState<Solapa>('escaneos');

  // CUÁNTOS ESCANEOS VIAJAN (09/10/2026, pedido suyo).
  //
  // El registro traía 300 escaneos siempre, también cuando la pantalla no lo
  // estaba mostrando. Ahora la pestaña de escaneos pide 0 —no dibuja la lista—,
  // la del registro pide 50, y "ver todos" sube a 2000. Lo que se LEE para los
  // totales no cambia: salen de los mismos eventos de siempre.
  const [expandido, setExpandido] = useState(false);
  // EL REGISTRO COMPLETO, AFUERA DE LA PANTALLA.
  //
  // El panel dibuja de a 2000 renglones porque más que eso traba el navegador.
  // Los escaneos no se borran nunca —están todos en la base desde el primer
  // día— pero "están en la base" no es lo mismo que "los tengo": esto arma el
  // CSV completo, lo guarda en el almacenamiento y lo manda a las mismas
  // casillas que reciben las estadísticas.
  const [exportando, setExportando] = useState(false);
  const [exportado, setExportado] = useState<{
    filas: number; truncado: boolean; tope: number; url: string | null; enviadoA: string[];
    limpiar?: boolean; conservarDias?: number; borrados?: number; conservados?: number;
    noSeBorroPorElMail?: boolean;
  } | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);
  const tope = solapa === 'registro' ? (expandido ? EXPANDIDO : MINIMIZADO) : 0;

  // EL FILTRO LO RESUELVE EL SERVIDOR, NO ESTA PANTALLA.
  //
  // Filtrar acá los 200 eventos ya cargados sería instantáneo, pero mentiría en
  // cuanto haya volumen: si una pieza tuvo escaneos más viejos que esos 200, al
  // filtrarla se verían incompletos sin que nada lo avise.
  const cargar = useCallback(async (
    canal?: string | null, v?: Ventana, franja?: { desde: number; hasta: number },
  ) => {
    setCargando(true);
    setError(null);
    try {
      const r = await httpsCallable(functions, 'verMarketing')({
        canal: canal || '',
        desdeMillis: v?.desde,
        hastaMillis: v?.hasta,
        horaDesde: franja?.desde ?? 0,
        horaHasta: franja?.hasta ?? 23,
        topeDeEventos: tope,
      });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron leer las visitas.'));
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [tope]);

  const exportar = useCallback(async (limpiar: boolean) => {
    // LA LIMPIEZA SE PREGUNTA, porque borra documentos de producción y no se
    // puede deshacer. El texto dice exactamente qué se va y qué se queda: sin
    // eso, "limpiar" se lee como "ordenar la pantalla".
    if (limpiar && !window.confirm(
      `Se va a guardar el archivo, mandarlo por mail y DESPUÉS borrar de la base los escaneos`
      + ` de más de ${CONSERVAR_DIAS} días que entren en él.\n\n`
      + `Los de los últimos ${CONSERVAR_DIAS} días no se tocan: con ellos esta pestaña dibuja`
      + ` los totales, el detalle por pieza y a qué hora escanean.\n\n`
      + 'Si el mail no sale, no se borra nada. ¿Seguimos?',
    )) return;
    setExportando(true); setErrorExport(null); setExportado(null);
    try {
      const r = await httpsCallable(functions, 'exportarEscaneos')({
        canal: filtro || '',
        desdeMillis: ventana?.desde,
        hastaMillis: ventana?.hasta,
        horaDesde,
        horaHasta,
        limpiar,
        conservarDias: CONSERVAR_DIAS,
      });
      setExportado(r.data as never);
    } catch (e) {
      setErrorExport(mensajeDeError(e, 'No se pudo armar el archivo.'));
    } finally {
      setExportando(false);
    }
  }, [filtro, ventana, horaDesde, horaHasta]);

  // Los filtros vivos, en un ref: el efecto de abajo tiene que volver a pedir
  // CON LOS FILTROS PUESTOS cuando cambia el tope, sin volver a pedir también
  // cada vez que se toca un filtro —eso ya lo hace el control que se tocó—.
  const puestos = useRef<{ canal: string | null; v: Ventana; franja: { desde: number; hasta: number } }>({
    canal: null, v: null, franja: { desde: 0, hasta: 23 },
  });
  puestos.current = { canal: filtro, v: ventana, franja: { desde: horaDesde, hasta: horaHasta } };

  // Al abrir, y cada vez que cambia cuántos escaneos hay que traer.
  useEffect(() => {
    const p = puestos.current;
    void cargar(p.canal, p.v, p.franja);
  }, [cargar]);

  const canales = Object.entries(datos?.canales || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const mayor = canales.length ? canales[0][1] : 0;

  return (
    <>
      <div className="ledger-filtros">
        {SOLAPAS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`ledger-chip${s.key === solapa ? ' ledger-chip-activo' : ''}`}
            onClick={() => setSolapa(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {(solapa === 'escaneos' || solapa === 'registro') && (
        <>
          <p className="admin-sub" style={{ marginBottom: 12 }}>
            {solapa === 'registro'
              ? 'Escaneo por escaneo, del más nuevo al más viejo. El día y la franja de acá '
                + 'abajo mandan sobre la lista.'
              : 'Cuánta gente entró desde cada pieza impresa. Son escaneos de QR, no descargas: '
                + 'la cuenta se corta cuando el teléfono salta a la tienda.'}
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
                  void cargar(filtro, v, { desde: horaDesde, hasta: horaHasta });
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
                  void cargar(filtro, v, { desde: horaDesde, hasta: horaHasta });
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
                  void cargar(filtro, v, { desde: horaDesde, hasta: horaHasta });
                }}
              />
            </span>
            {!!ventana && <span className="ledger-rango-lectura">{comoSeLee(ventana)}</span>}
          </div>

          {/* LA FRANJA HORARIA, aparte de la fecha y no adentro.
              "De 18 a 22" no es un rango de tiempo continuo: es una franja que se
              repite todos los días del período. Mezclarla con el selector de fechas
              haría creer que se elige "del lunes a las 18 al martes a las 22", que
              es otra cosa. */}
          <div className="ledger-filtros">
            <span className="ledger-rango">
              <span className="admin-sub">Entre las</span>
              <select
                aria-label="Desde la hora"
                value={horaDesde}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setHoraDesde(h);
                  void cargar(filtro, ventana, { desde: h, hasta: horaHasta });
                }}
              >
                {HORAS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
              </select>
              <span className="ledger-rango-sep">y las</span>
              <select
                aria-label="Hasta la hora"
                value={horaHasta}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setHoraHasta(h);
                  void cargar(filtro, ventana, { desde: horaDesde, hasta: h });
                }}
              >
                {HORAS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:59</option>)}
              </select>
            </span>
            {(horaDesde !== 0 || horaHasta !== 23) && (
              <>
                <button
                  type="button"
                  className="ledger-chip"
                  onClick={() => {
                    setHoraDesde(0); setHoraHasta(23);
                    void cargar(filtro, ventana, { desde: 0, hasta: 23 });
                  }}
                >
                  Todo el día
                </button>
                <span className="ledger-rango-lectura">
                  {horaDesde > horaHasta
                    ? `de las ${String(horaDesde).padStart(2, '0')} a las ${String(horaHasta).padStart(2, '0')}:59 del día siguiente`
                    : `de las ${String(horaDesde).padStart(2, '0')} a las ${String(horaHasta).padStart(2, '0')}:59`}
                </span>
              </>
            )}
          </div>

          {error && <p className="admin-error-inline">{error}</p>}
          {cargando && !datos && <p className="admin-loading">Cargando…</p>}

          {/* El mapa va al final y no arriba: los escaneos son lo que cambia todos
              los días y el mapa se mueve de a poco. Lo de arriba es lo que se mira
              seguido. */}
          {datos && solapa === 'escaneos' && (
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

              {reparto(datos.sistemas) && (
                <div className="admin-card">
                  <h3>Con qué teléfono escanean</h3>
                  <p className="admin-sub">
                    {reparto(datos.sistemas)}. Sirve para leer bien los números: mientras una
                    de las dos tiendas no esté publicada, los escaneos de ese sistema no son
                    interesados, son rebotes.
                  </p>
                  <p className="admin-sub">
                    Se empezó a guardar el <b>29/09/2026</b>. Lo anterior figura como "otro"
                    porque no hay dato, no porque haya sido de escritorio.
                  </p>
                </div>
              )}

              {datos.truncado && (
                <p className="admin-error-inline">
                  Hay más escaneos de los que se pueden leer de una. Achicá el período para
                  que los números sean exactos.
                </p>
              )}

              <div className="admin-card">
                <h3>Por pieza</h3>
                <p className="admin-sub">
                  Están TODAS las piezas, incluso las que no trajeron a nadie todavía: un cero
                  también es un dato — dice que ese QR no se usó, o que la tanda no salió.
                </p>
                {(datos.grupos || []).map((g) => (
                  <div key={g.titulo}>
                    <div className="admin-sub" style={{
                      fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                      marginTop: 18, marginBottom: 6, fontSize: 11,
                    }}
                    >
                      {g.titulo}
                    </div>
                    <ul className="admin-lista">
                      {g.canales.map((canal) => {
                        const n = datos.canales?.[canal] || 0;
                        return (
                          <li key={canal} style={{ display: 'block', opacity: n ? 1 : 0.45 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                              <span>{datos.nombres?.[canal] || canal}</span>
                              <span>
                                <strong>{n}</strong>
                                <span className="admin-sub"> · {porcentaje(n, datos.total)}</span>
                              </span>
                            </div>
                            {reparto(datos.sistemaPorCanal?.[canal]) && (
                              <div className="admin-sub" style={{ marginTop: 2 }}>
                                {reparto(datos.sistemaPorCanal[canal])}
                              </div>
                            )}
                            {/* La barra se mide contra la pieza que más trajo, no contra
                                el total: lo que interesa es comparar una con otra. */}
                            <div style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,.25)', marginTop: 6 }}>
                              <div style={{
                                height: 6, borderRadius: 3, background: 'var(--accent, #F2C94C)',
                                width: `${mayor ? Math.max(n ? 3 : 0, (n / mayor) * 100) : 0}%`,
                              }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
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

              {/* A QUÉ HORA ESCANEAN.
                  Es el dato que decide a qué hora pegar y a qué hora publicar, y no
                  se puede sacar de ninguna otra pantalla. Un afiche que junta
                  escaneos a las 8 está en un camino al trabajo; uno que los junta
                  el sábado a las 21 está en una salida. Son dos afiches distintos
                  aunque digan lo mismo. */}
              <div className="admin-card">
                <h3>A qué hora escanean</h3>
                <p className="admin-sub">
                  Las 24 horas del día, en hora de Buenos Aires, sumando todos los días del
                  período. El gráfico muestra el día entero aunque haya una franja elegida: si
                  se filtrara a sí mismo no se podría ver dónde está el pico de verdad.
                </p>
                {(() => {
                  const horas = datos.porHoraSinFranja || [];
                  const pico = Math.max(...horas, 1);
                  const total = horas.reduce((a, b) => a + b, 0);
                  const dentro = (h: number) => (
                    horaDesde <= horaHasta
                      ? h >= horaDesde && h <= horaHasta
                      : h >= horaDesde || h <= horaHasta
                  );
                  if (!total) {
                    return <p className="admin-sub">Todavía no hay ningún escaneo en este período.</p>;
                  }
                  const mejor = horas.indexOf(pico);
                  return (
                    <>
                      <div className="horas-grafico">
                        {horas.map((n, h) => (
                          <button
                            key={h}
                            type="button"
                            className={`horas-barra${dentro(h) ? '' : ' horas-barra-apagada'}`}
                            title={`${String(h).padStart(2, '0')}:00 — ${n} escaneo${n === 1 ? '' : 's'}`}
                            onClick={() => {
                              // Tocar una hora la elige como franja de una sola
                              // hora; tocarla de nuevo vuelve al día entero.
                              const sola = horaDesde === h && horaHasta === h;
                              const d = sola ? 0 : h, t = sola ? 23 : h;
                              setHoraDesde(d); setHoraHasta(t);
                              void cargar(filtro, ventana, { desde: d, hasta: t });
                            }}
                          >
                            <span className="horas-valor" style={{ height: `${Math.round((n / pico) * 100)}%` }} />
                            <span className="horas-rotulo">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>
                          </button>
                        ))}
                      </div>
                      <p className="admin-sub">
                        La hora más fuerte es las <b>{String(mejor).padStart(2, '0')}:00</b>, con{' '}
                        {pico} de {total} ({porcentaje(pico, total)}). Tocá una barra para ver sólo
                        esa hora en toda la pantalla.
                      </p>
                    </>
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

          {datos && solapa === 'registro' && (
            <div className="admin-card">
              <h3>Registro de escaneos</h3>
              <p className="admin-sub">
                Cada escaneo con su origen, el día de la semana, la fecha y la hora, del más
                nuevo al más viejo. No se guarda nada de quien escaneó: sólo qué QR y cuándo.
              </p>
              <p className="admin-sub">
                Entran los últimos <b>{expandido ? EXPANDIDO : MINIMIZADO}</b> del período
                elegido arriba. Está minimizado a propósito: abrir Marketing no tiene por qué
                traer y dibujar miles de renglones.
              </p>
              <p className="admin-sub">
                <b>Ningún escaneo se borra nunca.</b> El tope de {EXPANDIDO} es cuántos DIBUJA
                esta pantalla, no cuántos hay: están todos guardados desde el primer día. Para
                tenerlos afuera, "Bajar TODO" arma el CSV completo, lo guarda en el
                almacenamiento de la app y lo manda a las casillas que reciben las estadísticas.
                Además, el mail de las 2:00 trae todos los escaneos del día anterior.
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
                  onClick={() => { setFiltro(null); void cargar(null, ventana, { desde: horaDesde, hasta: horaHasta }); }}
                >
                  Todos
                </button>
                {canales.map(([canal]) => (
                  <button
                    key={canal}
                    type="button"
                    className={`btn${filtro === canal ? '' : ' btn-outline'}`}
                    onClick={() => { setFiltro(canal); void cargar(canal, ventana, { desde: horaDesde, hasta: horaHasta }); }}
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
                const hay = datos.eventosEnLaVentana ?? lista.length;
                return (
                  <>
                  {/* CUÁNTOS SE ESTÁN VIENDO DE CUÁNTOS. Sin esto, una lista de
                      50 renglones se lee como "hubo 50 escaneos". */}
                  <div className="ledger-filtros" style={{ marginBottom: 10 }}>
                    <span className="admin-sub">
                      Mostrando <b>{lista.length}</b> de <b>{hay}</b>
                      {hay <= lista.length ? ' — ya se ven todos los del período' : ''}
                    </span>
                    {(hay > lista.length || expandido) && (
                      <button
                        type="button"
                        className={`ledger-chip${expandido ? ' ledger-chip-activo' : ''}`}
                        onClick={() => setExpandido((v) => !v)}
                      >
                        {expandido ? `Mostrar sólo los últimos ${MINIMIZADO}` : `Ver todos (${hay})`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="ledger-chip"
                      disabled={exportando}
                      onClick={() => { void exportar(false); }}
                    >
                      {exportando ? 'Armando el archivo…' : 'Bajar TODO y mandarlo por mail'}
                    </button>
                    <button
                      type="button"
                      className="ledger-chip"
                      disabled={exportando}
                      onClick={() => { void exportar(true); }}
                    >
                      …y limpiar lo de más de {CONSERVAR_DIAS} días
                    </button>
                  </div>
                  {errorExport && <p className="admin-error-inline">{errorExport}</p>}
                  {exportado && (
                    <p className="admin-sub">
                      Listo: <b>{exportado.filas}</b> escaneos en el archivo
                      {exportado.enviadoA?.length
                        ? `, mandado a ${exportado.enviadoA.join(', ')}`
                        : ''}
                      . Queda guardado en el almacenamiento de la app.
                      {exportado.url && (
                        <>
                          {' '}
                          <a href={exportado.url} target="_blank" rel="noreferrer">Descargarlo acá</a>
                          {' (el enlace dura 24 h; el archivo no se borra).'}
                        </>
                      )}
                      {exportado.truncado && (
                        <>
                          {' '}
                          <b>Cortado en {exportado.tope}:</b> hay más. Pedilo por partes con el
                          filtro de fechas.
                        </>
                      )}
                      {exportado.limpiar && (
                        <>
                          {' '}
                          {exportado.noSeBorroPorElMail
                            ? 'NO se borró nada: el mail no salió.'
                            : `Borrados de la base: ${exportado.borrados ?? 0}.`
                              + ` Quedan ${exportado.conservados ?? 0} en la base, los de los`
                              + ` últimos ${exportado.conservarDias} días.`}
                        </>
                      )}
                    </p>
                  )}
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
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* Se montan y se desmontan con la solapa, a propósito: así volver trae
          lo de ahora y no lo que había cuando se salió. */}
      {solapa === 'mapa' && <MapaDensidad />}
      {solapa === 'falta' && <QueFalta />}
    </>
  );
}
