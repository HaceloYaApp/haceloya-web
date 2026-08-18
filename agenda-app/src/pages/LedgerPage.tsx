import { useCallback, useEffect, useState } from 'react';
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

type LedgerItem = {
  id: string;
  detalle: string;
  precio: number;
  outcome: string | null;
  createdAtMillis: number | null;
};

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

  const load = useCallback(async (targetBucket: Bucket, cursorMillis?: number) => {
    const call = httpsCallable(functions, 'listarRegistro');
    const resp: any = await call({ seccion: targetBucket, cursorMillis });
    // `listarRegistro` devuelve más campos que los que esta pantalla muestra
    // (comisión, quién ofrece, quién busca): se mapea a lo que se usa acá y el
    // resto queda disponible para cuando haga falta.
    const crudos: any[] = resp?.data?.items || [];
    const newItems: LedgerItem[] = crudos.map((v) => ({
      id: String(v.id || ''),
      detalle: String(v.detalle || ''),
      precio: Number(v.precio || 0),
      outcome: v.resultado || null,
      createdAtMillis: v.createdAtMillis ?? null,
    }));
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
  }, [bucket, load]);

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
                <span className="ledger-precio">${it.precio.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="ledger-card-meta">
                <span className="ledger-date">{it.createdAtMillis ? new Date(it.createdAtMillis).toLocaleString('es-AR') : ''}</span>
                {it.outcome && (
                  <span className={`ledger-outcome${it.outcome === 'cancelado' ? ' ledger-outcome-canceled' : ''}`}>
                    {it.outcome === 'cancelado' ? 'Cancelado' : 'Finalizado'}
                  </span>
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
