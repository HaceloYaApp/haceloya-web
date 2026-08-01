import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../firebase';
import './LedgerPage.css';

type Bucket = 'servicio' | 'servicio_mujer' | 'actividad' | 'turno' | 'marketplace';

const TABS: Array<{ key: Bucket; label: string }> = [
  { key: 'servicio', label: 'Servicios' },
  { key: 'servicio_mujer', label: 'Solo mujeres' },
  { key: 'actividad', label: 'Actividades' },
  { key: 'turno', label: 'Turnos' },
  { key: 'marketplace', label: 'Marketplace' },
];

type LedgerItem = {
  id: string;
  detalle: string;
  precio: number;
  outcome: 'finalizado' | 'cancelado' | null;
  createdAtMillis: number | null;
};

export default function LedgerPage({ onBack }: { onBack: () => void }) {
  const [bucket, setBucket] = useState<Bucket>('servicio');
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // TEMPORAL — botón para correr una sola vez la migración que rellena
  // isTargeted en los posts viejos (ver functions/src/migrations.ts, repo
  // de la app). Borrar este botón + handler apenas se confirme que corrió.
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const runBackfill = async () => {
    setBackfillRunning(true);
    setBackfillResult(null);
    try {
      const call = httpsCallable(functions, 'backfillPostIsTargeted');
      const resp: any = await call({});
      const data = resp?.data as any;
      setBackfillResult(`Listo: ${data?.scanned || 0} revisados, ${data?.updated || 0} actualizados.`);
    } catch (e: any) {
      setBackfillResult(`Error: ${e?.message || String(e)}`);
    } finally {
      setBackfillRunning(false);
    }
  };

  const load = useCallback(async (targetBucket: Bucket, cursorMillis?: number) => {
    const call = httpsCallable(functions, 'listLedgerEntries');
    const resp: any = await call({ bucket: targetBucket, cursorMillis });
    const newItems: LedgerItem[] = resp?.data?.items || [];
    setHasMore(newItems.length >= 50);
    return newItems;
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(bucket).then((newItems) => { if (!cancelled) setItems(newItems); })
      .catch((e) => { console.error('[Ledger] error cargando:', e); if (!cancelled) setItems([]); })
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
    } catch (e) {
      console.error('[Ledger] error cargando más:', e);
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

      {/* TEMPORAL — ver comentario en el estado backfillRunning arriba */}
      <div style={{ marginBottom: 16 }}>
        <button type="button" className="ledger-tab" disabled={backfillRunning} onClick={runBackfill}>
          {backfillRunning ? 'Ejecutando...' : 'Ejecutar migración isTargeted (una vez)'}
        </button>
        {!!backfillResult && <p style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 6 }}>{backfillResult}</p>}
      </div>

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
