import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { functions, db } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// LA COLA DE ARREPENTIMIENTOS (09/09/2026).
//
// El botón de arrepentimiento existe desde el 20/08/2026 y el mail que avisa
// termina diciendo "Resolvelo desde el panel". El panel no existía en ningún
// lado: la única forma de contestar era el mail, que sale de otra casilla y no
// deja rastro en la app.
//
// La resolución 424/2020 pone dos relojes —acusar recibo dentro de las 24 horas
// y devolver sin costo dentro del plazo—, así que esto es una COLA: primero lo
// que está por vencer. Es la misma pantalla que el panel del teléfono.

const OPERACION_LEGIBLE: Record<string, string> = {
  marketplace: 'Compra del marketplace',
  curso: 'Reserva de un curso',
  otra: 'Otra operación',
};

const ESTADO_LEGIBLE: Record<string, string> = {
  recibido: 'Sin acusar recibo',
  en_curso: 'En curso',
  resuelto: 'Resuelto',
  rechazado: 'Rechazado',
};

type Solicitud = {
  id: string; constancia: string; uid: string; operacion: string;
  referencia: string; detalle: string; quiereDinero: boolean; yaPago: boolean;
  comprobantes: string[]; estado: string; resultado: string | null;
  nota: string | null; montoDevuelto: number | null; createdAt: number | null;
  acusadoEn: number | null; horasParaAcusar: number | null; sinLeerDeLaPersona: number;
};

const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString('es-AR') : '—');

export default function ArrepentimientosPanel() {
  const [items, setItems] = useState<Solicitud[] | null>(null);
  const [cerrados, setCerrados] = useState(false);
  const [error, setError] = useState('');
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [abierta, setAbierta] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarArrepentimientos')({ soloAbiertos: !cerrados });
      setItems((r?.data?.arrepentimientos || []) as Solicitud[]);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer las solicitudes.'));
      setItems([]);
    }
  }, [cerrados]);

  useEffect(() => { cargar(); }, [cargar]);

  const gestionar = async (s: Solicitud, accion: string, label: string) => {
    const monto = Math.round(Number((montos[s.id] || '').replace(/\D/g, '')) || 0);
    if (accion === 'devolver_saldo' && !(monto > 0)) {
      setError('Poné cuánto se le devuelve como saldo a favor.');
      return;
    }
    if (accion === 'rechazar' && !(notas[s.id] || '').trim()) {
      setError('Un rechazo sin motivo escrito no se puede defender después.');
      return;
    }
    // Se confirma porque mueve plata o cierra el caso, y las dos cosas las ve
    // del otro lado alguien que no está mirando esta pantalla.
    if (!window.confirm(`${label}. ¿Seguro?`)) return;
    setTrabajando(s.id);
    setError('');
    try {
      await httpsCallable(functions, 'gestionarArrepentimiento')({
        solicitudId: s.id, accion, nota: notas[s.id] || '', monto,
      });
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo.'));
    } finally {
      setTrabajando(null);
    }
  };

  return (
    <section className="admin-card">
      <h2>Arrepentimientos</h2>
      <p className="admin-sub">
        Quien compró tiene diez días corridos para revocar, sin dar explicaciones (art. 34 de la Ley
        24.240). Hay que acusar recibo dentro de las 24 horas y devolver sin costo.
      </p>

      <button type="button" className="btn btn-outline" onClick={() => setCerrados((v) => !v)}>
        {cerrados ? 'Ver sólo los abiertos' : 'Ver todos'}
      </button>

      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">
          {cerrados ? 'Todavía no hubo ninguna solicitud.' : 'No hay solicitudes sin resolver.'}
        </p>
      ) : (
        <ul className="admin-lista">
          {items.map((s) => {
            const vencido = s.horasParaAcusar !== null && s.horasParaAcusar < 0;
            const cerrada = s.estado === 'resuelto' || s.estado === 'rechazado';
            return (
              <li key={s.id}>
                <strong>{s.constancia} · {fecha(s.createdAt)}</strong>

                {/* EL RELOJ ARRIBA DE TODO: es lo único que se vence, y lo que
                    decide por cuál empezar. */}
                {s.horasParaAcusar !== null && (
                  <span className={vencido ? 'admin-error-inline' : 'admin-sub'}>
                    {vencido
                      ? `El acuse de recibo venció hace ${Math.abs(Math.round(s.horasParaAcusar))} h`
                      : `Quedan ${Math.max(0, Math.round(s.horasParaAcusar))} h para acusar recibo`}
                  </span>
                )}

                <span className="admin-sub">
                  {OPERACION_LEGIBLE[s.operacion] || s.operacion} · {ESTADO_LEGIBLE[s.estado] || s.estado}
                  {s.resultado === 'saldo' && s.montoDevuelto
                    ? ` · se le devolvieron $${s.montoDevuelto.toLocaleString('es-AR')} como saldo`
                    : ''}
                  {s.resultado === 'medio_de_pago' ? ' · reintegrado al medio de pago' : ''}
                </span>
                {!!s.referencia && <span className="admin-sub">Referencia: {s.referencia}</span>}
                <p className="admin-detalle">“{s.detalle || '(sin detalle)'}”</p>
                <span className="admin-sub">Cuenta: {s.uid}</span>
                {/* Las dos líneas que cambian lo que hay que hacer. */}
                <span className="admin-sub">
                  {s.yaPago ? 'Dice que YA PAGÓ.' : 'No dice haber pagado.'}{' '}
                  {s.quiereDinero ? 'Pide la devolución al medio de pago.' : 'Acepta saldo a favor.'}
                </span>
                {s.comprobantes.map((url, i) => (
                  <a key={url} className="admin-link" href={url} target="_blank" rel="noreferrer">
                    Ver comprobante {i + 1}
                  </a>
                ))}
                {!!s.nota && <span className="admin-sub">Nota: {s.nota}</span>}

                {!cerrada && (
                  <>
                    <label className="admin-label" htmlFor={`nota-arr-${s.id}`}>
                      Motivo o nota (obligatorio para rechazar)
                    </label>
                    <input
                      id={`nota-arr-${s.id}`}
                      className="admin-input"
                      value={notas[s.id] || ''}
                      onChange={(e) => setNotas((p) => ({ ...p, [s.id]: e.target.value }))}
                    />
                    <label className="admin-label" htmlFor={`monto-arr-${s.id}`}>
                      Monto a devolver como saldo
                    </label>
                    <input
                      id={`monto-arr-${s.id}`}
                      className="admin-input"
                      inputMode="numeric"
                      value={montos[s.id] || ''}
                      onChange={(e) => setMontos((p) => ({ ...p, [s.id]: e.target.value.replace(/\D/g, '') }))}
                    />

                    <div className="admin-acciones">
                      {!s.acusadoEn && (
                        <button
                          type="button" className="btn btn-outline" disabled={trabajando === s.id}
                          title="Cumple las 24 horas sin decidir todavía."
                          onClick={() => gestionar(s, 'acusar_recibo', 'Acusar recibo')}
                        >
                          Acusar recibo
                        </button>
                      )}
                      <button
                        type="button" className="btn btn-outline" disabled={trabajando === s.id}
                        title="Se le acredita al instante en la app."
                        onClick={() => gestionar(s, 'devolver_saldo', 'Devolver como saldo a favor')}
                      >
                        Devolver como saldo
                      </button>
                      <button
                        type="button" className="btn btn-outline" disabled={trabajando === s.id}
                        title="El reintegro se hace en Mercado Pago; acá queda la constancia."
                        onClick={() => gestionar(s, 'reintegrado', 'Marcar reintegrado al medio de pago')}
                      >
                        Ya reintegré por Mercado Pago
                      </button>
                      <button
                        type="button" className="btn btn-outline" disabled={trabajando === s.id}
                        title="Con el motivo escrito arriba."
                        onClick={() => gestionar(s, 'rechazar', 'Rechazar la revocación')}
                      >
                        Rechazar
                      </button>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setAbierta(abierta === s.id ? null : s.id)}
                >
                  {abierta === s.id ? 'Cerrar la conversación' : 'Escribirle a quien pidió'}
                  {s.sinLeerDeLaPersona > 0 ? ` · ${s.sinLeerDeLaPersona} sin leer` : ''}
                </button>
                {abierta === s.id && <Conversacion solicitudId={s.id} alEscribir={cargar} />}
              </li>
            );
          })}
        </ul>
      )}

      {!!error && <p className="admin-error-inline">{error}</p>}
    </section>
  );
}

// Casi siempre lo que falta para resolver es una sola pregunta ("¿de qué compra
// es?"), y hasta hoy esa pregunta costaba un mail que quizás nadie lee. Acá
// queda pegada a la solicitud y la persona la ve donde pidió.
function Conversacion({ solicitudId, alEscribir }: { solicitudId: string; alEscribir: () => void }) {
  const [mensajes, setMensajes] = useState<Array<{ id: string; texto: string; deModeracion: boolean }>>([]);
  const [texto, setTexto] = useState('');
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = query(
      collection(db, 'arrepentimientos', solicitudId, 'mensajes'),
      orderBy('createdAt', 'asc'),
    );
    const unsub = onSnapshot(
      q,
      (snap) => setMensajes(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => { /* sin permiso o sin red: queda vacía y el campo sigue sirviendo */ },
    );
    return () => unsub();
  }, [solicitudId]);

  const mandar = async () => {
    const limpio = texto.trim();
    if (!limpio || mandando) return;
    setMandando(true);
    setError('');
    try {
      await httpsCallable(functions, 'escribirEnArrepentimiento')({ solicitudId, texto: limpio });
      setTexto('');
      alEscribir();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo mandar.'));
    } finally {
      setMandando(false);
    }
  };

  return (
    <div className="admin-chat">
      {mensajes.length === 0 ? (
        <span className="admin-sub">Todavía no se escribieron mensajes.</span>
      ) : mensajes.map((m) => (
        <p key={m.id} className="admin-detalle">
          <strong>{m.deModeracion ? 'Administración' : 'Quien pidió'}: </strong>{m.texto}
        </p>
      ))}
      <input
        className="admin-input"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') mandar(); }}
        placeholder="Escribile algo"
      />
      <button type="button" className="btn" disabled={mandando || !texto.trim()} onClick={mandar}>
        {mandando ? 'Mandando...' : 'Mandar'}
      </button>
      {!!error && <p className="admin-error-inline">{error}</p>}
    </div>
  );
}
