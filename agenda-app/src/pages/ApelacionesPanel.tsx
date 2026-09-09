import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// LA COLA DE APELACIONES, QUE EN LA WEB NO EXISTÍA (09/09/2026).
//
// La estrella roja automática se le pone a QUIEN APRETÓ CANCELAR, y esa señal
// es imperfecta: quien cancela puede ser justamente el que se portó bien —avisó
// en vez de desaparecer— mientras el otro lo dejó plantado y no tocó nada. Esta
// pantalla es donde eso se corrige, y del lado de la app existe desde el
// 24/08/2026.
//
// Que faltara acá no era un hueco cosmético: del otro lado hay alguien con una
// sanción puesta esperando que la miren, y quien modera desde la computadora no
// tenía forma de enterarse siquiera de que la cola existía.
//
// Las cuatro decisiones son las cuatro cosas que pueden haber pasado de verdad.
// "Pasarla a la otra parte" y "a los dos" son las que hacen que el sistema
// valga la pena: sin ellas, la única salida honesta sería no poner nunca la
// estrella.

const DECISIONES: Array<{ key: string; label: string; ayuda: string }> = [
  { key: 'dejar', label: 'Dejarla', ayuda: 'La estrella está bien puesta.' },
  { key: 'sacar', label: 'Sacarla', ayuda: 'No correspondía, y no es de nadie.' },
  { key: 'mover', label: 'Pasarla a la otra parte', ayuda: 'Se la pusimos al que no era.' },
  { key: 'ambos', label: 'Ponérsela a los dos', ayuda: 'Los dos hicieron su parte.' },
];

const SECCION_LEGIBLE: Record<string, string> = {
  trabajo: 'Oficios',
  marketplace: 'Market',
  clase: 'Clases y cursos',
  entrevista: 'Entrevista laboral',
};

const MOTIVO_LEGIBLE: Record<string, string> = {
  cancelacion: 'Canceló la operación',
  inaccion: 'No cerró la operación a tiempo',
  // La que deja un moderador al fallar un reclamo (09/09/2026). No es
  // automática: la puso una persona, y hasta hoy no se podía discutir.
  estrella_de_admin: 'Estrella puesta por un moderador al resolver un reclamo',
};

type Apelacion = {
  id: string;
  uid: string;
  seccion: string;
  operacionId: string;
  contraparteUid: string | null;
  motivo: string | null;
  texto: string;
  estado: string;
  createdAt?: { _seconds?: number; seconds?: number } | number | null;
};

const fecha = (v: Apelacion['createdAt']) => {
  const ms = typeof v === 'number'
    ? v
    : ((v?._seconds ?? v?.seconds) ? Number(v?._seconds ?? v?.seconds) * 1000 : 0);
  return ms ? new Date(ms).toLocaleDateString('es-AR') : '—';
};

export default function ApelacionesPanel() {
  const [items, setItems] = useState<Apelacion[] | null>(null);
  const [error, setError] = useState('');
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [resolviendo, setResolviendo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarApelaciones')({ soloAbiertas: true });
      setItems((r?.data?.apelaciones || []) as Apelacion[]);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer las apelaciones.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const resolver = async (ap: Apelacion, resultado: string, label: string) => {
    // Se confirma porque no hay vuelta atrás: una apelación se resuelve una
    // sola vez, y "pasarla a la otra parte" le pone una sanción a alguien que
    // no está mirando esta pantalla.
    if (!window.confirm(`${label}. ¿Seguro?`)) return;
    setResolviendo(ap.id);
    setError('');
    try {
      await httpsCallable(functions, 'resolverApelacion')({
        apelacionId: ap.id, resultado, nota: notas[ap.id] || '',
      });
      setItems((prev) => (prev || []).filter((x) => x.id !== ap.id));
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo resolver.'));
    } finally {
      setResolviendo(null);
    }
  };

  return (
    <section className="admin-card">
      <h2>Apelaciones</h2>
      <p className="admin-sub">
        Estrellas automáticas que alguien discute. La pone el sistema a quien cancela, y esa señal no
        siempre acierta: quien cancela a veces es el que avisó, no el que falló.
      </p>

      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">No hay apelaciones sin resolver.</p>
      ) : (
        <ul className="admin-lista">
          {items.map((ap) => (
            <li key={ap.id}>
              <strong>{SECCION_LEGIBLE[ap.seccion] || ap.seccion} · {fecha(ap.createdAt)}</strong>
              <span className="admin-sub">
                {MOTIVO_LEGIBLE[ap.motivo || ''] || ap.motivo || 'Estrella automática'}
              </span>
              <p className="admin-detalle">“{ap.texto}”</p>
              <span className="admin-sub">Apela: {ap.uid}</span>
              <span className="admin-sub">
                {ap.contraparteUid
                  ? `Otra parte: ${ap.contraparteUid}`
                  : 'Sin la otra parte registrada: sólo se puede dejar o sacar.'}
              </span>

              <label className="admin-label" htmlFor={`nota-${ap.id}`}>Nota (opcional)</label>
              <input
                id={`nota-${ap.id}`}
                className="admin-input"
                value={notas[ap.id] || ''}
                onChange={(e) => setNotas((p) => ({ ...p, [ap.id]: e.target.value }))}
                placeholder="Queda registrada con la decisión."
              />

              <div className="admin-acciones">
                {DECISIONES.map((d) => {
                  // Sin la otra parte no hay a quién pasársela ni con quién
                  // compartirla: el botón que no puede funcionar no se ofrece.
                  const sinContraparte = !ap.contraparteUid && (d.key === 'mover' || d.key === 'ambos');
                  return (
                    <button
                      key={d.key}
                      type="button"
                      className="btn btn-outline"
                      title={d.ayuda}
                      disabled={sinContraparte || resolviendo === ap.id}
                      onClick={() => resolver(ap, d.key, d.label)}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!!error && <p className="admin-error-inline">{error}</p>}
      <button type="button" className="btn btn-outline" onClick={cargar} style={{ marginTop: 12 }}>
        Actualizar
      </button>
    </section>
  );
}
