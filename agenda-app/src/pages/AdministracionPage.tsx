import { useState } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import LedgerPage from './LedgerPage';
import ModeracionPage from './ModeracionPage';
import AdminPage from './AdminPage';
import type { PermisosDeAdmin } from '../utils/permisosDeAdmin';
import './LedgerPage.css';
import './AdminPage.css';

// TODA LA ADMINISTRACIÓN EN UNA SOLA PANTALLA.
//
// Eran tres botones separados en el encabezado de la agenda —Resumen,
// Moderación, Administradores— y cada uno abría una página entera que tapaba a
// las otras dos. Para pasar de aprobar un pago a mirar el registro había que
// volver a la agenda y entrar por otra puerta.
//
// Son tres caras de la misma tarea, así que ahora son tres pestañas de la misma
// pantalla y se cambia de una a otra sin salir. El botón de la agenda quedó uno
// solo: "Administración".
//
// El orden no es casual. "Moderación" va primera porque es lo único de acá
// donde hay alguien esperando una respuesta; el resumen y los administradores
// se consultan, no urgen.

type Pestana = 'moderacion' | 'resumen' | 'administradores';

// CADA PESTAÑA CUELGA DE SU PERMISO (09/09/2026).
//
// Es la misma línea que traza el backend, y tiene que decir lo mismo que la
// app: mostrar una pestaña que el servidor va a rechazar hace que la persona
// vea un error donde tendría que entender que ese acceso no es suyo.
//
// El Resumen lo abre también `mujer`: adentro va a ver una sola sección —la
// suya—, que es exactamente lo que ese permiso otorga.
const PESTANAS: Array<{ key: Pestana; label: string; bajada: string; puede: (p: PermisosDeAdmin) => boolean }> = [
  {
    key: 'moderacion',
    label: 'Moderación',
    bajada: 'Pagos por aprobar, reclamos, denuncias y cuentas bloqueadas.',
    puede: (p) => p.moderacion || p.resumen,
  },
  {
    key: 'resumen',
    label: 'Resumen',
    bajada: 'El registro de todas las transacciones, por sección.',
    puede: (p) => p.resumen || p.mujer,
  },
  {
    key: 'administradores',
    label: 'Administradores',
    bajada: 'Quiénes tienen acceso, cuánta gente hay y si los procesos corren.',
    puede: (p) => p.admin,
  },
];

export default function AdministracionPage(
  { permisos, onBack }: { permisos: PermisosDeAdmin; onBack: () => void },
) {
  const visibles = PESTANAS.filter((p) => p.puede(permisos));
  // Arranca en null y la resuelve `visibles[0]` hasta que se elige una: fijar
  // 'moderacion' de entrada dejaba a quien no la tiene mirando una pestaña
  // vacía. Es el mismo cuidado que en el panel de la app (H-R10-18).
  const [elegida, setElegida] = useState<Pestana | null>(null);
  const pestana: Pestana | null = elegida && visibles.some((p) => p.key === elegida)
    ? elegida
    : (visibles[0]?.key ?? null);
  const actual = visibles.find((p) => p.key === pestana);

  return (
    <div className="admin-page">
      <header className="agenda-header">
        <div>
          <h1>Administración</h1>
          <p className="agenda-sub">{actual?.bajada || 'Tu cuenta no tiene ningún acceso de administración.'}</p>
        </div>
        <div className="agenda-header-actions">
          <button type="button" className="btn btn-outline" onClick={onBack}>← Volver a la agenda</button>
          <button type="button" className="btn btn-outline logout-btn" onClick={() => signOut(auth)}>Salir</button>
        </div>
      </header>

      <div className="hazard-stripe" style={{ marginBottom: 16 }} />

      {/* Las pestañas de primer nivel se ven distintas de las solapas que hay
          adentro de Moderación y del Resumen. Si fueran los mismos chips, dos
          filas seguidas de lo mismo no dejarían ver cuál manda sobre cuál. */}
      <nav className="admin-tabs" aria-label="Secciones de administración">
        {visibles.map((p) => (
          <button
            key={p.key}
            type="button"
            className={`admin-tab${p.key === pestana ? ' admin-tab-activa' : ''}`}
            aria-current={p.key === pestana ? 'page' : undefined}
            onClick={() => setElegida(p.key)}
          >
            {p.label}
          </button>
        ))}
      </nav>

      {/* Montadas y desmontadas a propósito: cada una trae sus datos al
          aparecer, así volver a una pestaña muestra lo de ahora y no lo que
          había cuando se salió. En moderación eso importa — un pago aprobado
          desde otro lado tiene que desaparecer de la cola. */}
      {pestana === 'moderacion' && <ModeracionPage permisos={permisos} />}
      {pestana === 'resumen' && <LedgerPage permisos={permisos} />}
      {pestana === 'administradores' && <AdminPage />}
    </div>
  );
}
