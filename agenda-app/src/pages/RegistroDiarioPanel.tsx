import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// EL REGISTRO DIARIO POR MAIL, QUE EN LA WEB NO ESTABA (09/09/2026).
//
// Todos los días a las 2:00 se arma una planilla con las operaciones del día y
// se manda a estas direcciones; el archivo además queda guardado para siempre.
// Es la evidencia contable de cada jornada.
//
// Desde el teléfono se podía elegir a quién le llega y forzar un envío para
// probar que llega de verdad; desde la computadora, no existía. Y quién decide
// el destino es exactamente el dato que hay que poder ver: lo que sale todos
// los días son nombres, uid y montos de cada operación, y el descargo textual
// de cada persona bloqueada.

// `estado` y `error` los devuelve el callable desde siempre (ver
// exportacionDiaria.ts) y la web los ignoraba: un envío que explotó se pintaba
// como "0 operaciones · a 0 direcciones", igual que un día sin movimiento. La
// evidencia contable de una jornada no se generaba y el panel decía que ese día
// no pasó nada (10/09/2026).
type Envio = {
  dia?: string; operaciones?: number; enviadoA?: number;
  estado?: string; error?: string;
};

export default function RegistroDiarioPanel() {
  const [lista, setLista] = useState<string[] | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [quienCambio, setQuienCambio] = useState<{ nombre: string | null; cuando: number | null }>(
    { nombre: null, cuando: null },
  );
  const [ultimas, setUltimas] = useState<Envio[]>([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'configDeExportacion')({});
      setLista(r?.data?.destinatarios || []);
      setQuienCambio({
        nombre: r?.data?.actualizadoPorNombre || null,
        cuando: r?.data?.actualizadoEn || null,
      });
      setUltimas((r?.data?.ultimas || []) as Envio[]);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer la configuración.'));
      setLista([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (destinatarios: string[]) => {
    setTrabajando(true);
    setError('');
    setAviso('');
    try {
      const r: any = await httpsCallable(functions, 'guardarDestinatariosDeExportacion')({ destinatarios });
      setLista(r?.data?.destinatarios || destinatarios);
      setNuevo('');
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo guardar.'));
    } finally {
      setTrabajando(false);
    }
  };

  const agregar = () => {
    const limpio = nuevo.trim().toLowerCase();
    if (!limpio.includes('@')) { setError('Escribí un email válido.'); return; }
    if ((lista || []).includes(limpio)) { setNuevo(''); return; }
    guardar([...(lista || []), limpio]);
  };

  const quitar = (email: string) => {
    if ((lista || []).length <= 1) {
      // Sin destinatarios el registro se seguiría guardando, pero nadie lo
      // recibiría y no habría forma de darse cuenta.
      setError('Tiene que quedar uno: el registro necesita al menos un destinatario.');
      return;
    }
    guardar((lista || []).filter((x) => x !== email));
  };

  const enviarAhora = async () => {
    if (!window.confirm(
      'Rehace el archivo del último día cerrado y lo manda por mail. Sirve para probar que llega.',
    )) return;
    setTrabajando(true);
    setError('');
    setAviso('');
    try {
      const r: any = await httpsCallable(functions, 'generarExportacionAhora')({});
      setAviso(`Enviado. Registro del ${r?.data?.dia}: ${r?.data?.operaciones} operaciones.`);
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo enviar.'));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>Registro diario por mail</h2>
      <p className="admin-sub">
        Todos los días a las 2:00 se arma una planilla con las operaciones del día y se manda a estas
        direcciones. El archivo además queda guardado para siempre.
      </p>

      {lista === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : (
        <ul className="admin-lista">
          {lista.map((email) => (
            <li key={email} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <strong style={{ flex: 1 }}>{email}</strong>
              <button
                type="button"
                className="btn btn-outline"
                disabled={trabajando}
                onClick={() => quitar(email)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* QUIÉN LO CAMBIÓ. Lo que sale todos los días a esta lista son nombres,
          uid y montos de cada operación, y el descargo textual de cada persona
          bloqueada: quién decide el destino es exactamente el dato que hay que
          poder ver. */}
      {(quienCambio.nombre || quienCambio.cuando) && (
        <p className="admin-sub">
          Última vez que se cambió esta lista
          {quienCambio.nombre ? `: ${quienCambio.nombre}` : ''}
          {quienCambio.cuando
            ? `, el ${new Date(quienCambio.cuando).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })}`
            : ''}
        </p>
      )}

      <label className="admin-label" htmlFor="registro-email">Agregar una dirección</label>
      <input
        id="registro-email"
        className="admin-input"
        type="email"
        value={nuevo}
        onChange={(e) => setNuevo(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
        placeholder="nombre@ejemplo.com"
      />

      <div className="admin-acciones">
        <button type="button" className="btn" disabled={trabajando} onClick={agregar}>
          {trabajando ? 'Guardando...' : 'Agregar'}
        </button>
        <button type="button" className="btn btn-outline" disabled={trabajando} onClick={enviarAhora}>
          Enviar el registro de ayer
        </button>
      </div>

      {ultimas.length > 0 && (
        <>
          <h2 style={{ marginTop: 18 }}>Últimos envíos</h2>
          <ul className="admin-lista">
            {ultimas.map((u, i) => (
              <li key={`${u.dia}-${i}`}>
                <strong>{u.dia}</strong>
                {u.estado === 'error' ? (
                  <span className="admin-warn">
                    · no se pudo generar{u.error ? `: ${u.error}` : ''}
                  </span>
                ) : (
                  <span className="admin-sub">
                    {u.operaciones ?? 0} operaciones
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {!!aviso && <p className="admin-ok">{aviso}</p>}
      {!!error && <p className="admin-error-inline">{error}</p>}
    </section>
  );
}
