import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query, limit as fsLimit } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// LOS RECLAMOS, QUE NO SE PODÍAN LISTAR EN NINGÚN LADO.
//
// Un reclamo se resolvía sólo desde adentro de la conversación: alguien lo
// abría, aparecía la barra de moderación en ese chat, y ahí se pausaba o se
// fallaba. El problema era llegar: ninguna pantalla los listaba, así que había
// que saber de antemano en qué conversación estaba el caso.
//
// Importa desde el 19/08/2026, cuando los reclamos del marketplace pasaron a
// caer acá: quien toca "Reclamar" por un producto abre un caso que, sin esta
// lista, se quedaba esperando a que alguien adivinara dónde estaba.
//
// EL LÍMITE DE ACCESO ES EL MISMO QUE EN LA APP, y no lo pone esta pantalla: lo
// ponen las reglas de Firestore. El moderador puede leer la conversación
// MIENTRAS el reclamo está abierto, y pierde el acceso al resolverlo. Es la
// regla que las dos partes ven anunciada cuando se abre el caso, así que la web
// no abre ninguna puerta nueva.

type Reclamo = {
  id: string;
  seccion: string;
  motivo: string;
  estado: string;
  refPath: string | null;
  conversationPath: string | null;
  abiertoPor: string | null;
  partes: string[];
  nombres: Record<string, string>;
  resolucion: string | null;
  createdAtMillis: number | null;
  diasEsperando: number | null;
  chatPausado: boolean;
};

type Mensaje = { id: string; senderUid: string; text: string; createdAtMillis: number | null };

const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleString('es-AR') : '—');

const SECCION_LEGIBLE: Record<string, string> = {
  servicio: 'Servicio',
  marketplace: 'Marketplace',
  curso: 'Curso u oficio',
  oficio: 'Curso u oficio',
  oferta_laboral: 'Oferta laboral',
};

export default function ReclamosPanel() {
  const [estado, setEstado] = useState<'abierto' | 'resuelto'>('abierto');
  const [items, setItems] = useState<Reclamo[] | null>(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<Reclamo | null>(null);

  const cargar = useCallback(async (cual: string) => {
    setItems(null);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarReclamos')({ estado: cual });
      setItems(r?.data?.items || []);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos cargar los reclamos.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(estado); }, [estado, cargar]);

  if (abierto) {
    return (
      <UnReclamo
        reclamo={abierto}
        onVolver={() => { setAbierto(null); cargar(estado); }}
      />
    );
  }

  return (
    <section className="admin-card">
      <div className="ledger-filtros">
        {([['abierto', 'Sin resolver'], ['resuelto', 'Resueltos']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={`ledger-chip${k === estado ? ' ledger-chip-activo' : ''}`}
            onClick={() => setEstado(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {!!error && <p className="admin-error-inline">{error}</p>}
      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">
          {estado === 'abierto' ? 'No hay reclamos esperando.' : 'Todavía no se resolvió ninguno.'}
        </p>
      ) : (
        items.map((r) => (
          <div key={r.id} className="admin-caso">
            <div className="admin-numero-fila">
              <strong>{SECCION_LEGIBLE[r.seccion] || r.seccion || 'Reclamo'}</strong>
              {/* Hace cuánto espera: es lo que hace visible que algo se está
                  quedando sin atender. Los abiertos vienen del backend con el
                  MÁS VIEJO PRIMERO, por el mismo motivo. */}
              {r.estado === 'abierto' && typeof r.diasEsperando === 'number' && (
                <span className={r.diasEsperando >= 3 ? 'admin-error-inline' : 'admin-sub'}>
                  {r.diasEsperando === 0 ? 'hoy' : `hace ${r.diasEsperando} ${r.diasEsperando === 1 ? 'día' : 'días'}`}
                </span>
              )}
            </div>
            <span className="admin-sub">
              {r.partes.map((uid) => r.nombres[uid] || uid).join('  ·  ')}
            </span>
            {!!r.motivo && <p className="admin-detalle">“{r.motivo}”</p>}
            {r.chatPausado && <span className="admin-error-inline">El chat está pausado</span>}
            {!!r.resolucion && <span className="admin-sub">Resuelto: {r.resolucion.replace(/_/g, ' ')}</span>}
            <div className="admin-acciones">
              <button type="button" className="btn" onClick={() => setAbierto(r)}>
                {r.estado === 'abierto' ? 'Abrir y resolver' : 'Ver'}
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

const RESOLUCIONES: Array<{ key: string; label: (r: Reclamo) => string }> = [
  {
    key: 'a_favor_de_quien_ofrece',
    label: (r) => `A favor de ${r.nombres[r.partes[0]] || 'quien ofrece'}`,
  },
  {
    key: 'a_favor_de_quien_busca',
    label: (r) => `A favor de ${r.nombres[r.partes[1]] || 'quien reclamó'}`,
  },
  { key: 'desestimado', label: () => 'Se resolvió entre las partes' },
];

function UnReclamo({ reclamo, onVolver }: { reclamo: Reclamo; onVolver: () => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [errorChat, setErrorChat] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [pausado, setPausado] = useState(reclamo.chatPausado);
  const [nota, setNota] = useState('');

  // La conversación, leída directo de Firestore. Las reglas dejan al moderador
  // entrar SÓLO mientras el reclamo está abierto: si ya se resolvió, esto va a
  // devolver permission-denied, y eso es lo correcto — no un error a explicar.
  useEffect(() => {
    if (!reclamo.conversationPath) { setMensajes([]); return undefined; }
    const q = query(
      collection(db, `${reclamo.conversationPath}/messages`),
      orderBy('createdAt', 'asc'),
      fsLimit(200),
    );
    const unsub = onSnapshot(q, (snap) => {
      const arr: Mensaje[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        arr.push({
          id: d.id,
          senderUid: String(v?.senderUid || ''),
          text: String(v?.text || ''),
          createdAtMillis: v?.createdAt?.toMillis?.() ?? null,
        });
      });
      setMensajes(arr);
      setErrorChat('');
    }, () => {
      setMensajes([]);
      setErrorChat(
        reclamo.estado === 'abierto'
          ? 'No pudimos leer la conversación.'
          : 'El caso ya está cerrado: el acceso a la conversación se cierra con él.',
      );
    });
    return () => unsub();
  }, [reclamo.conversationPath, reclamo.estado]);

  const pausar = async () => {
    if (trabajando) return;
    setTrabajando(true);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'bloquearChatDelReclamo')({
        reclamoId: reclamo.id,
        bloquear: !pausado,
      });
      setPausado(r?.data?.bloqueado === true);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo.'));
    } finally {
      setTrabajando(false);
    }
  };

  const resolver = async (resolucion: string) => {
    if (trabajando) return;
    if (!window.confirm(
      'Al resolver, el fallo se publica dentro de la conversación y perdés el acceso a leerla. ¿Seguro?',
    )) return;
    setTrabajando(true);
    setError('');
    try {
      await httpsCallable(functions, 'resolverReclamo')({
        reclamoId: reclamo.id,
        resolucion,
        nota: nota.trim(),
      });
      onVolver();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo resolver.'));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <section className="admin-card">
      <div className="admin-acciones">
        <button type="button" className="btn btn-outline" onClick={onVolver}>← Volver a la lista</button>
      </div>

      <h2>{SECCION_LEGIBLE[reclamo.seccion] || reclamo.seccion || 'Reclamo'}</h2>
      <span className="admin-sub">
        {reclamo.partes.map((uid) => reclamo.nombres[uid] || uid).join('  ·  ')} · abierto {fecha(reclamo.createdAtMillis)}
      </span>
      {!!reclamo.motivo && <p className="admin-detalle">“{reclamo.motivo}”</p>}

      <h2 style={{ marginTop: 18 }}>La conversación</h2>
      {mensajes === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : errorChat ? (
        <p className="admin-warn">{errorChat}</p>
      ) : mensajes.length === 0 ? (
        <p className="admin-sub">No hay mensajes en esta conversación.</p>
      ) : (
        <div className="reclamo-chat">
          {mensajes.map((m) => (
            <div key={m.id} className="reclamo-msg">
              <span className="admin-sub">
                {m.senderUid === 'sistema' ? 'Sistema' : (reclamo.nombres[m.senderUid] || m.senderUid)} · {fecha(m.createdAtMillis)}
              </span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      )}

      {reclamo.estado === 'abierto' && (
        <>
          <div className="admin-acciones">
            <button type="button" className="btn btn-outline" disabled={trabajando} onClick={pausar}>
              {pausado ? 'Reabrir el chat' : 'Pausar el chat mientras reviso'}
            </button>
          </div>

          <label className="admin-label" htmlFor="reclamo-nota">Nota para las dos partes (opcional)</label>
          <input
            id="reclamo-nota"
            className="admin-input"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Se publica junto con el fallo, dentro de la conversación."
          />

          <div className="admin-acciones">
            {RESOLUCIONES.map((r) => (
              <button
                key={r.key}
                type="button"
                className="btn"
                disabled={trabajando}
                onClick={() => resolver(r.key)}
              >
                {r.label(reclamo)}
              </button>
            ))}
          </div>
          <p className="admin-sub">
            Al resolver, el fallo se publica dentro de la conversación y el acceso del moderador se
            cierra con el caso. Es la otra mitad de lo que se les prometió a las partes.
          </p>
        </>
      )}

      {!!error && <p className="admin-error-inline">{error}</p>}
    </section>
  );
}
