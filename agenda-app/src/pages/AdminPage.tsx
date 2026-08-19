import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './AdminPage.css';

// LA MISMA SECCIÓN "ADMINISTRADORES" QUE LA APP.
//
// Hasta el 19/08/2026 la web mostraba sólo el registro contable: quien
// administraba desde la compu no tenía forma de ver quién tiene acceso, ni de
// darlo o quitarlo, ni de saber si los procesos automáticos están corriendo.
// Tenía que agarrar el teléfono.
//
// Los callables son EXACTAMENTE los mismos que usa la app y todos verifican
// del lado del servidor que quien llama sea administrador, así que llevar esto
// a la web no abre ninguna puerta nueva: lo que se puede hacer acá se podía
// hacer desde el teléfono con las mismas credenciales.

type Administrador = {
  uid: string;
  email: string;
  nombre: string;
  porClaim: boolean;
  porCodigo: boolean;
  existe: boolean;
};

type Proceso = {
  nombre: string;
  estado: 'ok' | 'atrasado' | 'falla' | 'nunca';
  ultimaCorridaMs: number | null;
  ultimoExitoMs: number | null;
};

const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleString('es-AR') : 'nunca');
const numero = (v: number | null | undefined) => (typeof v === 'number' ? v.toLocaleString('es-AR') : '—');

export default function AdminPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="admin-page">
      <header className="agenda-header">
        <div>
          <h1>Administradores</h1>
          <p className="agenda-sub">
            Un administrador puede aprobar los pagos por transferencia y ver el registro de transacciones.
          </p>
        </div>
        <div className="agenda-header-actions">
          <button type="button" className="btn btn-outline" onClick={onBack}>← Volver</button>
          <button type="button" className="btn btn-outline logout-btn" onClick={() => signOut(auth)}>Salir</button>
        </div>
      </header>

      <div className="hazard-stripe" style={{ marginBottom: 16 }} />

      <QuienesTienenAcceso />
      <CuantaGenteHay />
      <SaludDeLosProcesos />
    </div>
  );
}

// QUIÉNES SON, Y CÓMO SE AGREGA O SE SACA.
//
// Las dos cosas van juntas en la misma tarjeta a propósito: dar acceso sin ver
// la lista es lo que había antes, y es cómo se llega a tener un administrador
// que nadie recuerda haber agregado.
function QuienesTienenAcceso() {
  const [lista, setLista] = useState<Administrador[] | null>(null);
  const [quienSoy, setQuienSoy] = useState<string | null>(null);
  const [completo, setCompleto] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarAdministradores')({});
      setLista(Array.isArray(r?.data?.administradores) ? r.data.administradores : []);
      setQuienSoy(r?.data?.quienSoy || null);
      setCompleto(r?.data?.completo !== false);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer la lista de administradores.'));
      setLista([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const llamar = async (grant: boolean) => {
    const limpio = email.trim().toLowerCase();
    if (!limpio.includes('@')) {
      setError('Escribí el email de la cuenta.');
      return;
    }
    if (!grant && !window.confirm(`${limpio} va a dejar de poder aprobar pagos. ¿Seguro?`)) return;
    setTrabajando(true);
    setError('');
    setAviso('');
    try {
      await httpsCallable(functions, 'grantAdminRole')({ email: limpio, grant });
      // El claim entra cuando esa cuenta renueva su token: hasta una hora, o al
      // reabrir la app. Decirlo evita el "no me funciona" de los primeros
      // cinco minutos.
      setAviso(
        `${grant ? 'Listo, ya es administrador' : 'Listo, se le quitó el acceso'}: ${limpio}. ` +
        'El cambio entra en vigencia cuando esa persona vuelva a entrar (o dentro de una hora).',
      );
      setEmail('');
      await cargar();
    } catch (e) {
      // El callable rechaza a propósito varias cosas —cuenta inexistente, mail
      // sin verificar, quitarse el acceso a uno mismo— y su mensaje ya explica
      // cuál. Mostrarlo tal cual es mejor que traducirlo a un genérico.
      setError(mensajeDeError(e, 'No se pudo.'));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <section className="admin-card">
      <h2>Quiénes tienen acceso</h2>

      {lista === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : lista.length === 0 ? (
        <p className="admin-warn">No hay ninguna cuenta con acceso. Eso no debería pasar.</p>
      ) : (
        <ul className="admin-lista">
          {lista.map((a) => (
            <li key={a.uid}>
              <strong>{a.email || a.uid}{a.uid === quienSoy ? '  (vos)' : ''}</strong>
              {!!a.nombre && <span className="admin-sub">{a.nombre}</span>}
              {a.existe === false ? (
                <span className="admin-error-inline">
                  Esta cuenta ya no existe: sacala de la lista del código.
                </span>
              ) : (
                <span className="admin-sub">
                  {[a.porCodigo ? 'por código' : '', a.porClaim ? 'por acceso dado' : ''].filter(Boolean).join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {!completo && (
        <p className="admin-warn">
          No se pudieron revisar todas las cuentas: puede haber alguna más que no figure acá.
        </p>
      )}

      <label className="admin-label" htmlFor="admin-email">Email de la cuenta</label>
      <input
        id="admin-email"
        className="admin-input"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="nombre@ejemplo.com"
      />

      <div className="admin-acciones">
        <button type="button" className="btn" disabled={trabajando} onClick={() => llamar(true)}>
          {trabajando ? 'Guardando...' : 'Dar acceso de administrador'}
        </button>
        <button type="button" className="btn btn-outline" disabled={trabajando} onClick={() => llamar(false)}>
          Quitar acceso
        </button>
      </div>

      <p className="admin-sub">
        La cuenta tiene que existir en la app y tener el email verificado. Es a propósito: sin eso,
        alguien podría registrarse con un mail ajeno sin confirmarlo y quedarse con el acceso por un
        error de tipeo. Tampoco podés quitarte el acceso a vos mismo.
      </p>

      {!!aviso && <p className="admin-ok">{aviso}</p>}
      {!!error && <p className="admin-error-inline">{error}</p>}
    </section>
  );
}

// Cuántas cuentas hay vivas hoy, que no es lo mismo que cuántas se registraron.
function CuantaGenteHay() {
  const [datos, setDatos] = useState<Record<string, number | null> | null>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'cuantaGenteHay')({});
      setDatos((r?.data || {}) as Record<string, number | null>);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer los números.'));
      setDatos({});
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const FILAS: Array<{ campo: string; etiqueta: string; ayuda?: string }> = [
    { campo: 'total', etiqueta: 'Cuentas registradas' },
    { campo: 'altasDeHoy', etiqueta: 'Se registraron hoy' },
    {
      campo: 'verificados',
      etiqueta: 'Con DNI verificado',
      ayuda: 'Son los que pueden publicar, vender y dar clases: sin eso, sólo miran.',
    },
    { campo: 'profesionales', etiqueta: 'Cuentas profesionales' },
    { campo: 'conTarjetaDeTrabajo', etiqueta: 'Con CV publicado' },
  ];

  return (
    <section className="admin-card">
      <h2>Cuánta gente hay</h2>
      {datos === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : (
        <>
          {!!error && <p className="admin-warn">{error}</p>}
          {FILAS.map((f) => (
            <div key={f.campo} className="admin-numero">
              <div className="admin-numero-fila">
                <span>{f.etiqueta}</span>
                {/* "—" y no "0": un cero se leería como "no hay nadie", que es
                    una afirmación, y si la cuenta falló no la podemos hacer. */}
                <strong>{numero(datos[f.campo])}</strong>
              </div>
              {!!f.ayuda && <span className="admin-sub">{f.ayuda}</span>}
            </div>
          ))}
        </>
      )}
      <button type="button" className="btn btn-outline" onClick={cargar}>Actualizar</button>
    </section>
  );
}

// Si los procesos automáticos están corriendo.
//
// Hay dos síntomas y se dicen distinto: "no corrió" (el scheduler dejó de
// dispararlo) y "corre y no termina" (arranca todos los días y explota antes
// del final). El segundo es el que más engaña, porque desde afuera algo corre.
function SaludDeLosProcesos() {
  const [procesos, setProcesos] = useState<Proceso[] | null>(null);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'saludDeLosProcesos')({});
      setProcesos(Array.isArray(r?.data?.procesos) ? r.data.procesos : []);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer el estado de los procesos.'));
      setProcesos([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const texto = (p: Proceso): string => {
    if (p.estado === 'nunca') return 'Nunca corrió';
    if (p.estado === 'atrasado') return `No corre desde ${fecha(p.ultimaCorridaMs)}`;
    if (p.estado === 'falla') return `Arranca pero no termina — último final: ${fecha(p.ultimoExitoMs)}`;
    return `Última corrida: ${fecha(p.ultimoExitoMs)}`;
  };

  return (
    <section className="admin-card">
      <h2>Procesos automáticos</h2>
      {procesos === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : procesos.length === 0 ? (
        <p className="admin-warn">{error || 'Sin datos todavía.'}</p>
      ) : (
        procesos.map((p) => (
          <div key={p.nombre} className="admin-numero">
            <strong>{p.nombre}</strong>
            <span className={p.estado === 'ok' ? 'admin-sub' : 'admin-error-inline'}>{texto(p)}</span>
          </div>
        ))
      )}
      <button type="button" className="btn btn-outline" onClick={cargar}>Actualizar</button>
    </section>
  );
}
