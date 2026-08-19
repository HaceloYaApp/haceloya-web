import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../firebase';
import './LedgerPage.css';

// ESTA PÁGINA LLAMABA A UN CALLABLE QUE SE BORRÓ.
//
// Usaba `listLedgerEntries`, que aceptaba cuatro de las once secciones que
// escribe el ledger y para "marketplace" ni siquiera leía el ledger: leía
// `marketplaceSales` y sacaba el precio de otro campo. Se dio de baja el
// 19/08/2026 junto con la vista vieja del panel de la app, que era su otro
// llamador. Hallazgo H-T12-10.
//
// Ahora usa `listarRegistro`, que es el que usa el panel de la app: conoce las
// once secciones, devuelve la comisión y distingue "no cobramos" de "no lo
// sabemos". Con eso, además, esta pantalla puede mostrar las siete secciones
// que antes no podía pedir.
type Bucket =
  | 'todos' | 'servicio' | 'servicio_mujer' | 'actividad' | 'turno'
  | 'curso' | 'oficio' | 'marketplace' | 'oferta_laboral'
  | 'usuario_nuevo' | 'baja_usuario' | 'reclamo';

const TABS: Array<{ key: Bucket; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'servicio', label: 'Servicios' },
  { key: 'servicio_mujer', label: 'Solo mujeres' },
  { key: 'actividad', label: 'Actividades' },
  { key: 'turno', label: 'Turnos' },
  { key: 'curso', label: 'Cursos' },
  { key: 'oficio', label: 'Oficios' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'oferta_laboral', label: 'Oferta laboral' },
  { key: 'usuario_nuevo', label: 'Nuevos usuarios' },
  { key: 'baja_usuario', label: 'Bajas' },
  { key: 'reclamo', label: 'Reclamos' },
];

// LO QUE DEVUELVE `listarRegistro`, ENTERO.
//
// Antes esta pantalla se quedaba con cuatro campos de los doce que llegan: no
// mostraba la comisión, ni si estaba cobrada, ni quiénes son las dos partes, ni
// ninguno de los totales. Mirar el mismo registro desde la compu y desde el
// teléfono daba dos fotos distintas de la misma plata. Decisión del 19/08/2026.
type LedgerItem = {
  id: string;
  detalle: string;
  precio: number;
  comision: number;
  comisionPagada: boolean;
  /**
   * Los asientos anteriores al 12/08/2026 no guardaban la comisión. Sin esta
   * bandera se veían como "Free", que significa lo contrario: que la operación
   * no generó comisión. Es la diferencia entre "no cobramos" y "no lo sabemos",
   * y en un panel de plata no se pueden confundir.
   */
  comisionConocida: boolean;
  ofreceNombre: string;
  buscaNombre: string;
  resultado: string | null;
  createdAtMillis: number | null;
};

type Totales = {
  cobrado: number; cobradoOps: number;
  adeudado: number; adeudadoOps: number;
  volumen: number; operaciones: number;
  ticketPromedio: number;
  canceladas: number; cerradas: number; tasaCancelacion: number;
};

/** Los mismos tres estados que filtra el panel de la app. */
type Filtro = 'todos' | 'pagados' | 'impagos' | 'free';
const FILTROS: Array<{ key: Filtro; label: string }> = [
  { key: 'todos', label: 'Todos' },
  { key: 'pagados', label: 'Cobrados' },
  { key: 'impagos', label: 'Impagos' },
  { key: 'free', label: 'Sin comisión' },
];

const ETIQUETA_RESULTADO: Record<string, string> = {
  finalizado: 'Finalizado', concretado: 'Concretado', cancelado: 'Cancelado',
  postulado: 'Postulado', preseleccionado: 'Preseleccionado', aceptado: 'Aceptado',
  alta: 'Alta', baja: 'Baja', abierto: 'Sin resolver', resuelto: 'Resuelto',
};

const plata = (n: number) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

export default function LedgerPage({ onBack }: { onBack: () => void }) {
  const [bucket, setBucket] = useState<Bucket>('servicio');
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Mismo hallazgo que en AgendaPage: sin esto, un error del callable dejaba
  // items en [] y la UI mostraba "No hay registros", indistinguible de que en
  // verdad no hay nada.
  const [loadError, setLoadError] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  // `null` no es cero: si alguna agregación no se pudo calcular, el backend
  // manda `totalesConfiables: false` y acá se muestra "no se pudo" en vez de
  // pintar un cero, que se leería como "no hubo movimiento".
  const [totales, setTotales] = useState<Totales | null>(null);
  // El filtro va por ref además de por estado: `load` está memoizado y si
  // dependiera del estado se volvería a crear en cada cambio, disparando el
  // efecto dos veces. La ref le da el valor de AHORA sin entrar en las
  // dependencias.
  const filtroRef = useRef<Filtro>('todos');
  useEffect(() => { filtroRef.current = filtro; }, [filtro]);

  const load = useCallback(async (targetBucket: Bucket, cursorMillis?: number) => {
    const call = httpsCallable(functions, 'listarRegistro');
    const resp: any = await call({ seccion: targetBucket, filtro: filtroRef.current, cursorMillis });
    // `listarRegistro` devuelve más campos que los que esta pantalla muestra
    // (comisión, quién ofrece, quién busca): se mapea a lo que se usa acá y el
    // resto queda disponible para cuando haga falta.
    const crudos: any[] = resp?.data?.items || [];
    const newItems: LedgerItem[] = crudos.map((v) => ({
      id: String(v.id || ''),
      detalle: String(v.detalle || ''),
      precio: Number(v.precio || 0),
      comision: Number(v.comision || 0),
      comisionPagada: v.comisionPagada === true,
      comisionConocida: v.comisionConocida !== false,
      ofreceNombre: String(v.ofreceNombre || ''),
      buscaNombre: String(v.buscaNombre || ''),
      resultado: v.resultado || null,
      createdAtMillis: v.createdAtMillis ?? null,
    }));
    // Los totales son de TODA la sección, no de la página: sólo se guardan en
    // la primera carga, para que "Ver más" no los pise con los de otra tanda.
    if (!cursorMillis) {
      setTotales(resp?.data?.totalesConfiables === false ? null : (resp?.data?.totales || null));
    }
    // 40 por página, que es POR_PAGINA en panelRegistro.ts.
    setHasMore(newItems.length >= 40);
    return newItems;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(bucket).then((newItems) => { if (!cancelled) { setItems(newItems); setLoadError(''); } })
      .catch((e) => {
        console.error('[Ledger] error cargando:', e);
        if (!cancelled) { setItems([]); setLoadError('No pudimos cargar el registro. Revisá tu conexión y volvé a intentar.'); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bucket, filtro, load]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || items.length === 0) return;
    setLoadingMore(true);
    try {
      const last = items[items.length - 1];
      const newItems = await load(bucket, last.createdAtMillis || undefined);
      setItems((prev) => [...prev, ...newItems]);
      setLoadError('');
    } catch (e) {
      console.error('[Ledger] error cargando más:', e);
      setLoadError('No pudimos cargar más registros. Volvé a intentar.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="ledger-page">
      <header className="agenda-header">
        <div>
          <h1>Registro de transacciones</h1>
          <p className="agenda-sub">{items.length} {items.length === 1 ? 'entrada' : 'entradas'} en esta categoría</p>
        </div>
        <div className="agenda-header-actions">
          <button type="button" className="btn btn-outline" onClick={onBack}>← Volver a la agenda</button>
          <button type="button" className="btn btn-outline logout-btn" onClick={() => signOut(auth)}>Salir</button>
        </div>
      </header>

      <div className="hazard-stripe" style={{ marginBottom: 16 }} />

      {loadError && <div className="agenda-error">{loadError}</div>}

      <div className="ledger-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`ledger-tab${t.key === bucket ? ' ledger-tab-active' : ''}`}
            onClick={() => setBucket(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Los tres estados de la comisión, igual que en el panel de la app. */}
      <div className="ledger-filtros">
        {FILTROS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`ledger-chip${f.key === filtro ? ' ledger-chip-activo' : ''}`}
            onClick={() => setFiltro(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* LOS TOTALES DE TODA LA SECCIÓN, NO DE LA PÁGINA.
          Si alguna agregación no se pudo calcular, el backend manda
          `totalesConfiables: false` y acá se dice que no se pudo. Un cero se
          leería como "no hubo movimiento", que es otra cosa. */}
      {!loading && (
        totales ? (
          <div className="ledger-totales">
            <div className="ledger-total">
              <span className="ledger-total-num">{totales.operaciones.toLocaleString('es-AR')}</span>
              <span className="ledger-total-lbl">{totales.operaciones === 1 ? 'operación' : 'operaciones'}</span>
            </div>
            <div className="ledger-total">
              <span className="ledger-total-num">{plata(totales.volumen)}</span>
              <span className="ledger-total-lbl">
                volumen{totales.ticketPromedio > 0 ? ` · promedio ${plata(totales.ticketPromedio)}` : ''}
              </span>
            </div>
            <div className="ledger-total">
              <span className="ledger-total-num ledger-cobrado">{plata(totales.cobrado)}</span>
              <span className="ledger-total-lbl">cobrado · {totales.cobradoOps} op.</span>
            </div>
            <div className="ledger-total">
              <span className="ledger-total-num ledger-adeudado">{plata(totales.adeudado)}</span>
              <span className="ledger-total-lbl">adeudado · {totales.adeudadoOps} op.</span>
            </div>
            {(totales.canceladas + totales.cerradas) > 0 && (
              <div className="ledger-total">
                <span className={`ledger-total-num${totales.tasaCancelacion >= 25 ? ' ledger-adeudado' : ''}`}>
                  {totales.tasaCancelacion}%
                </span>
                <span className="ledger-total-lbl">
                  se cancelan · {totales.canceladas} de {totales.canceladas + totales.cerradas}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="ledger-empty">No se pudieron calcular los totales de esta sección.</p>
        )
      )}

      {loading ? (
        <div className="agenda-loading">Cargando...</div>
      ) : items.length === 0 ? (
        <p className="ledger-empty">No hay registros en esta categoría todavía.</p>
      ) : (
        <div className="ledger-list">
          {items.map((it) => (
            <div key={it.id} className="ledger-card">
              <div className="ledger-card-row">
                <span className="ledger-detalle">{it.detalle}</span>
                {it.precio > 0 && <span className="ledger-precio">{plata(it.precio)}</span>}
              </div>

              {/* Las dos partes. El panel de la app las muestra desde el
                  12/08/2026: sin ellas, una fila del registro no se puede
                  cruzar con nada. */}
              {(it.ofreceNombre || it.buscaNombre) && (
                <div className="ledger-partes">
                  {[
                    it.ofreceNombre && it.ofreceNombre !== 'Sin nombre' ? `Ofrece: ${it.ofreceNombre}` : '',
                    it.buscaNombre && it.buscaNombre !== 'Sin nombre' ? `Busca: ${it.buscaNombre}` : '',
                  ].filter(Boolean).join('  ·  ')}
                </div>
              )}

              <div className="ledger-card-meta">
                <span className="ledger-date">
                  {it.createdAtMillis ? new Date(it.createdAtMillis).toLocaleString('es-AR') : ''}
                  {it.resultado ? ` · ${ETIQUETA_RESULTADO[it.resultado] || it.resultado}` : ''}
                </span>
                {it.comision > 0 ? (
                  <span className={`ledger-pill${it.comisionPagada ? ' ledger-pill-cobrada' : ' ledger-pill-impaga'}`}>
                    {it.comisionPagada ? 'Cobrada' : 'Impaga'} {plata(it.comision)}
                  </span>
                ) : (
                  // "Sin dato" y "Free" no son lo mismo: uno es "no cobramos",
                  // el otro es "no lo sabemos".
                  <span className="ledger-pill">{it.comisionConocida ? 'Free' : 'Sin dato'}</span>
                )}
              </div>
            </div>
          ))}
          {hasMore && (
            <button type="button" className="btn btn-outline" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Cargando...' : 'Cargar más'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
