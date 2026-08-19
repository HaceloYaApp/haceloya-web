import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './AdminPage.css';

// PAGOS, DENUNCIAS Y BLOQUEADOS, LAS TRES QUE FALTABAN.
//
// Con esto la web termina de mostrar lo mismo que el panel de la app. Los
// callables son los mismos y todos verifican del lado del servidor que quien
// llama sea administrador.
//
// UNA ADVERTENCIA QUE VALE LA PENA TENER PRESENTE: aprobar un comprobante desde
// acá acredita plata de verdad y desbloquea una cuenta. La seguridad es la
// misma que en el teléfono, pero una sesión de navegador abierta en una compu
// compartida es más fácil de dejar olvidada que un teléfono en el bolsillo.

type Solapa = 'pagos' | 'denuncias' | 'bloqueados';

const SOLAPAS: Array<{ key: Solapa; label: string }> = [
  { key: 'pagos', label: 'Pagos por aprobar' },
  { key: 'denuncias', label: 'Denuncias' },
  { key: 'bloqueados', label: 'Bloqueados' },
];

const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleString('es-AR') : '—');
const plata = (n: number) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

export default function ModeracionPage({ onBack }: { onBack: () => void }) {
  const [solapa, setSolapa] = useState<Solapa>('pagos');

  return (
    <div className="admin-page">
      <header className="agenda-header">
        <div>
          <h1>Moderación</h1>
          <p className="agenda-sub">Pagos por aprobar, denuncias y cuentas bloqueadas.</p>
        </div>
        <div className="agenda-header-actions">
          <button type="button" className="btn btn-outline" onClick={onBack}>← Volver</button>
          <button type="button" className="btn btn-outline logout-btn" onClick={() => signOut(auth)}>Salir</button>
        </div>
      </header>

      <div className="hazard-stripe" style={{ marginBottom: 16 }} />

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

      {solapa === 'pagos' && <PagosPorAprobar />}
      {solapa === 'denuncias' && <Denuncias />}
      {solapa === 'bloqueados' && <Bloqueados />}
    </div>
  );
}

type PagoPendiente = {
  id: string; uid: string; proName: string; amount: number;
  receiptUrl: string | null; createdAt: number | null;
};

function PagosPorAprobar() {
  const [items, setItems] = useState<PagoPendiente[] | null>(null);
  const [error, setError] = useState('');
  const [revisando, setRevisando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listPendingTransferPayments')({});
      setItems(r?.data?.items || []);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos cargar los pagos.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const revisar = async (paymentId: string, aprobar: boolean) => {
    if (revisando) return;
    if (!window.confirm(
      aprobar
        ? 'Aprobar acredita el pago y desbloquea la cuenta. ¿Seguro?'
        : '¿Marcar este comprobante como rechazado?',
    )) return;
    setRevisando(paymentId);
    setError('');
    try {
      await httpsCallable(functions, 'reviewTransferPayment')({ paymentId, approve: aprobar });
      setItems((prev) => (prev || []).filter((it) => it.id !== paymentId));
    } catch (e) {
      // EL MENSAJE DEL SERVIDOR, NO UN "error" GENÉRICO.
      //
      // `reviewTransferPayment` tiene una reja hecha exactamente para el doble
      // cobro: si al aprobar la deuda ya está saldada, corta y explica que
      // aprobar ese comprobante lo cobraría dos veces y qué hacer con él. Un
      // "no se pudo, intentá de nuevo" diría justo lo contrario de lo que hay
      // que hacer. Mismo criterio que la app (hallazgo H-R8-11).
      setError(mensajeDeError(e, 'No se pudo procesar el pago.'));
    } finally {
      setRevisando(null);
    }
  };

  if (items === null) return <p className="admin-loading">Cargando...</p>;

  return (
    <section className="admin-card">
      <h2>Pagos por aprobar ({items.length})</h2>
      {!!error && <p className="admin-error-inline">{error}</p>}
      {items.length === 0 ? (
        <p className="admin-sub">No hay comprobantes esperando revisión.</p>
      ) : (
        items.map((p) => (
          <div key={p.id} className="admin-caso">
            <div className="admin-numero-fila">
              <strong>{p.proName || p.uid}</strong>
              <strong>{plata(p.amount)}</strong>
            </div>
            <span className="admin-sub">{fecha(p.createdAt)}</span>
            {p.receiptUrl ? (
              <a className="admin-link" href={p.receiptUrl} target="_blank" rel="noreferrer">
                Ver el comprobante
              </a>
            ) : (
              <span className="admin-sub">Sin comprobante adjunto.</span>
            )}
            <div className="admin-acciones">
              <button type="button" className="btn" disabled={revisando === p.id} onClick={() => revisar(p.id, true)}>
                {revisando === p.id ? 'Procesando...' : 'Aprobar'}
              </button>
              <button type="button" className="btn btn-outline" disabled={revisando === p.id} onClick={() => revisar(p.id, false)}>
                Rechazar
              </button>
            </div>
          </div>
        ))
      )}
      <button type="button" className="btn btn-outline" onClick={cargar}>Actualizar</button>
    </section>
  );
}

type DenunciaItem = {
  id: string; targetType: string; targetId: string; targetOwnerUid: string;
  reporterUid: string; motivo: string; detalle: string; estado: string;
  createdAt: number | null; resueltaPor: string | null; nota: string | null;
};

const ESTADOS = [
  { key: 'abierta', label: 'Abiertas' },
  { key: 'resuelta', label: 'Resueltas' },
  { key: 'descartada', label: 'Descartadas' },
];

// Los mismos textos que la app: si el panel de la compu llamara distinto a las
// mismas cosas, cruzar un caso entre los dos sería adivinar.
const MOTIVO_LEGIBLE: Record<string, string> = {
  spam: 'Spam o publicidad',
  contenido_inapropiado: 'Contenido inapropiado',
  estafa: 'Parece una estafa',
  acoso: 'Acoso o maltrato',
  datos_falsos: 'Datos falsos',
  otro: 'Otro motivo',
};

const TIPO_LEGIBLE: Record<string, string> = {
  user: 'Perfil',
  post: 'Pedido',
  proposal: 'Presupuesto',
  marketplaceListing: 'Publicación del marketplace',
  teachingListing: 'Curso u oficio',
  marketplaceQuestion: 'Pregunta pública',
  message: 'Mensaje',
  review: 'Reseña',
};

function Denuncias() {
  const [estado, setEstado] = useState('abierta');
  const [items, setItems] = useState<DenunciaItem[] | null>(null);
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async (cual: string) => {
    setItems(null);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarDenuncias')({ estado: cual });
      setItems(r?.data?.items || []);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos cargar las denuncias.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(estado); }, [estado, cargar]);

  const resolver = async (id: string, nuevoEstado: 'resuelta' | 'descartada') => {
    if (trabajando) return;
    if (!window.confirm(
      nuevoEstado === 'resuelta'
        ? '¿Marcar esta denuncia como resuelta?'
        : '¿Descartar esta denuncia?',
    )) return;
    setTrabajando(id);
    setError('');
    try {
      await httpsCallable(functions, 'resolverDenuncia')({ id, estado: nuevoEstado });
      await cargar(estado);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo.'));
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <section className="admin-card">
      <div className="ledger-filtros">
        {ESTADOS.map((e) => (
          <button
            key={e.key}
            type="button"
            className={`ledger-chip${e.key === estado ? ' ledger-chip-activo' : ''}`}
            onClick={() => setEstado(e.key)}
          >
            {e.label}
          </button>
        ))}
      </div>

      {!!error && <p className="admin-error-inline">{error}</p>}
      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">No hay denuncias en este estado.</p>
      ) : (
        items.map((d) => (
          <div key={d.id} className="admin-caso">
            <strong>{MOTIVO_LEGIBLE[d.motivo] || d.motivo}</strong>
            <span className="admin-sub">
              {TIPO_LEGIBLE[d.targetType] || d.targetType} · {fecha(d.createdAt)}
            </span>
            {!!d.detalle && <p className="admin-detalle">“{d.detalle}”</p>}
            {!!d.nota && <span className="admin-sub">Nota: {d.nota}</span>}
            {d.estado === 'abierta' && (
              <div className="admin-acciones">
                <button type="button" className="btn" disabled={trabajando === d.id} onClick={() => resolver(d.id, 'resuelta')}>
                  Marcar resuelta
                </button>
                <button type="button" className="btn btn-outline" disabled={trabajando === d.id} onClick={() => resolver(d.id, 'descartada')}>
                  Descartar
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </section>
  );
}

type Caso = {
  uid: string; nombre: string; strikes: number; racha: number;
  motivo: string; duracion: string; hasta: number | null; desde: number | null;
  permanente: boolean; enRevision: boolean;
  descargo: string | null; descargoAt: number | null;
};

const SUB = [
  { key: 'todos', label: 'Todos' },
  { key: 'permanentes', label: 'Permabloqueados' },
  { key: 'revision', label: 'En revisión' },
];

const DURACIONES = [
  { key: '1d', label: '1 día' },
  { key: '7d', label: '7 días' },
  { key: '1m', label: '1 mes' },
  { key: '1a', label: '1 año' },
  { key: 'permanente', label: 'Para siempre' },
];

function Bloqueados() {
  const [sub, setSub] = useState('todos');
  const [items, setItems] = useState<Caso[] | null>(null);
  const [totales, setTotales] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async (cual: string) => {
    setItems(null);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarBloqueados')({ filtro: cual });
      setItems(r?.data?.items || []);
      setTotales(r?.data?.totales || null);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos cargar las cuentas bloqueadas.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(sub); }, [sub, cargar]);

  const moderar = async (uid: string, accion: string, duracion?: string) => {
    if (trabajando) return;
    setTrabajando(uid);
    setError('');
    try {
      // 'ajustar_duracion' y no 'bloquear': cambiar cuánto dura algo no cambia
      // por qué se hizo. Mandando 'bloquear' con un motivo genérico se pisaba
      // el motivo original, se reseteaba desde cuándo estaba bloqueada y se
      // cerraba en silencio un caso que nadie había revisado. Mismo criterio
      // que la app (hallazgo H-R10-07).
      await httpsCallable(functions, 'moderarCuenta')({
        uid,
        accion: accion === 'bloquear' ? 'ajustar_duracion' : accion,
        duracion,
      });
      await cargar(sub);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo.'));
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <section className="admin-card">
      <div className="ledger-filtros">
        {SUB.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`ledger-chip${s.key === sub ? ' ledger-chip-activo' : ''}`}
            onClick={() => setSub(s.key)}
          >
            {s.label}{typeof totales?.[s.key] === 'number' ? ` (${totales[s.key]})` : ''}
          </button>
        ))}
      </div>

      {!!error && <p className="admin-error-inline">{error}</p>}
      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">No hay cuentas en este filtro.</p>
      ) : (
        items.map((c) => (
          <div key={c.uid} className="admin-caso">
            <div className="admin-numero-fila">
              <strong>{c.nombre || c.uid}</strong>
              <span className="admin-sub">{c.strikes} sanciones</span>
            </div>
            <span className="admin-sub">
              {c.motivo || 'Sin motivo registrado'} · desde {fecha(c.desde)}
              {c.permanente ? ' · para siempre' : c.hasta ? ` · hasta ${fecha(c.hasta)}` : ''}
            </span>
            {c.enRevision && <span className="admin-error-inline">En revisión</span>}

            {/* El descargo va ABAJO DE TODO y destacado: es lo único que
                escribió quien está del otro lado. Mismo lugar que en la app. */}
            {!!c.descargo && (
              <p className="admin-detalle">
                Su descargo ({fecha(c.descargoAt)}): “{c.descargo}”
              </p>
            )}

            <div className="admin-acciones">
              <button type="button" className="btn" disabled={trabajando === c.uid} onClick={() => moderar(c.uid, 'desbloquear')}>
                Levantar el bloqueo
              </button>
              {DURACIONES.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className="btn btn-outline"
                  disabled={trabajando === c.uid}
                  onClick={() => moderar(c.uid, 'bloquear', d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
