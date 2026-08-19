import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// QUIÉN MIRÓ LOS DATOS DE QUIÉN.
//
// Los accesos se anotaban desde el 17/08 —quién abrió los datos de contacto de
// alguien, quién bloqueó a quién, quién borró qué reseña— pero la colección
// está cerrada a todo el mundo salvo el servidor y no había ningún callable que
// la leyera. Se escribía y no la miraba nadie.
//
// Un registro que nadie puede leer no es un control, es un archivo. Y la
// política de privacidad declara que "cada uno de esos accesos queda
// registrado": eso sólo es cierto cuando alguien lo puede consultar. H-T6-15.

type Asiento = {
  id: string;
  accion: string;
  moderador: string;
  sobreUid: string;
  detalle: string;
  createdAtMillis: number | null;
};

// La misma traducción que usa la app, en `src/utils/auditoriaLegible.ts`. Hay
// un test que compara las dos listas: si acá falta una acción, el panel de la
// web mostraría la clave cruda donde la app muestra una frase.
const ACCION_LEGIBLE: Record<string, string> = {
  ver_datos_de_contacto: 'Miró datos de contacto',
  bloquear: 'Bloqueó la cuenta',
  desbloquear: 'Desbloqueó la cuenta',
  ajustar_duracion: 'Cambió la duración de un bloqueo',
  borrar_strike: 'Borró un strike',
  borrar_resena: 'Borró una reseña',
};

const nombreDe = (uid: string, nombres: Record<string, string>) => {
  const limpio = (uid || '').trim();
  if (!limpio) return 'alguien';
  return nombres[limpio] || limpio;
};

function describir(a: Asiento, nombres: Record<string, string>): string {
  const quien = nombreDe(a.moderador, nombres);
  // `sobreUid` puede traer VARIOS uid separados por coma: ver una operación
  // devuelve los datos de las dos partes de una sola vez, así que ese acceso es
  // sobre dos personas. Escribirlas a las dos es la diferencia entre un
  // registro y un registro engañoso.
  const sobre = String(a.sobreUid || '').split(',').map((u) => u.trim()).filter(Boolean)
    .map((u) => nombreDe(u, nombres));
  const cuando = a.createdAtMillis ? new Date(a.createdAtMillis).toLocaleString('es-AR') : 'sin fecha';
  if (sobre.length === 0) return `${quien} — ${cuando}`;
  return `${quien} → ${sobre.join(' y ')} — ${cuando}`;
}

export default function AuditoriaPanel() {
  const [items, setItems] = useState<Asiento[] | null>(null);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async (sobreUid?: string) => {
    setItems(null);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarAuditoria')(sobreUid ? { sobreUid } : {});
      setItems(r?.data?.items || []);
      setNombres(r?.data?.nombres || {});
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos leer el registro de accesos.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <section className="admin-card">
      <p className="admin-sub">
        Cada vez que alguien del equipo abre los datos de contacto de una persona, o toma una
        decisión de moderación sobre ella, queda anotado acá: quién, sobre quién y cuándo. Es lo que
        la política de privacidad promete, y sirve para las dos partes — para quien fue moderado y
        para quien tiene que defender una decisión correcta.
      </p>

      <label className="admin-label" htmlFor="auditoria-filtro">Id de una cuenta (opcional)</label>
      <input
        id="auditoria-filtro"
        className="admin-input"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') cargar(filtro.trim() || undefined); }}
        placeholder="Pegá un id para ver sólo lo que le hicieron a esa cuenta"
      />
      <div className="admin-acciones">
        <button type="button" className="btn" onClick={() => cargar(filtro.trim() || undefined)}>Ver</button>
        {!!filtro && (
          <button type="button" className="btn btn-outline" onClick={() => { setFiltro(''); cargar(); }}>
            Ver todo
          </button>
        )}
      </div>

      {!!error && <p className="admin-error-inline">{error}</p>}

      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">
          {filtro.trim()
            ? 'Nadie tocó esa cuenta.'
            : 'Todavía no hay nada anotado. Es lo esperable si nadie abrió el panel.'}
        </p>
      ) : (
        <ul className="admin-lista">
          {items.map((a) => (
            <li key={a.id}>
              <strong>{ACCION_LEGIBLE[a.accion] || a.accion}</strong>
              <span>{describir(a, nombres)}</span>
              {!!a.detalle && <span className="admin-sub">{a.detalle}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
