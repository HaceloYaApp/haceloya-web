import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// ---------------------------------------------------------------------------
// EL DETALLE DE UNA OPERACIÓN, QUE LA WEB NO TENÍA (10/09/2026).
//
// El panel del celular lo tiene desde siempre: se toca una fila del registro y
// se abre el documento completo de la operación MÁS el email, el teléfono y el
// domicilio de las dos partes. En la web las filas no eran clickeables y
// `verOperacion` no aparecía en ningún archivo.
//
// Qué significaba en la práctica: un moderador veía "Instalación eléctrica ·
// $85.000 · Impaga · Ofrece: Juan · Busca: Ana" y no tenía forma de llegar al
// teléfono de Juan para cobrarle la comisión. Tenía que agarrar el celular —
// que es literalmente lo que la regla del proyecto prohíbe.
//
// Y había un detalle peor: `verOperacion` deja asiento en la auditoría
// (`ver_datos_de_contacto`), así que la web mostraba en "Quién miró qué" una
// acción que la web no podía hacer.
//
// EL CALLABLE ES EL MISMO QUE USA LA APP, sin cambios. Trae su propio control
// de permisos: quien tiene sólo el acceso de sección sólo abre operaciones de
// esa sección, y desde el 09/09 además coteja que los uid pedidos sean los de
// ese asiento.
// ---------------------------------------------------------------------------

type Fila = {
  refPath?: string | null;
  ofreceUid?: string | null;
  buscaUid?: string | null;
  detalle?: string;
  precio?: number;
  comision?: number;
};

type Persona = {
  firstName?: string; lastName?: string;
  contacto?: { email?: string | null; phone?: string | null; direccion?: string | null };
  [k: string]: unknown;
};

const OCULTOS = new Set(['contacto', 'firstName', 'lastName', 'uid', 'id']);

function Parte({ titulo, persona }: { titulo: string; persona: Persona | null }) {
  if (!persona) {
    return (
      <div className="admin-caso">
        <strong>{titulo}</strong>
        <span className="admin-sub">
          Este asiento no guarda quién fue esta parte. Los anteriores al 12/08/2026 no lo anotaban.
        </span>
      </div>
    );
  }
  const nombre = [persona.firstName, persona.lastName].filter(Boolean).join(' ') || 'Sin nombre';
  const c = persona.contacto || {};
  return (
    <div className="admin-caso">
      <strong>{titulo}: {nombre}</strong>
      {/* El contacto es el motivo por el que esta pantalla existe: es lo que
          hace falta para cobrar una comisión sin salir del panel. */}
      <span className="admin-sub">
        {c.email || 'sin email'}{c.phone ? ` · ${c.phone}` : ''}
      </span>
      {!!c.direccion && <span className="admin-sub">{c.direccion}</span>}
      <div className="admin-campos">
        {Object.entries(persona)
          .filter(([k, v]) => !OCULTOS.has(k) && v != null && typeof v !== 'object')
          .map(([k, v]) => (
            <span key={k} className="admin-sub">{k}: {String(v)}</span>
          ))}
      </div>
    </div>
  );
}

export default function DetalleDeOperacion({ fila, alVolver }: { fila: Fila; alVolver: () => void }) {
  const [datos, setDatos] = useState<{ ofrece?: Persona; busca?: Persona; operacion?: unknown } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;
    setError('');
    setDatos(null);
    httpsCallable(functions, 'verOperacion')({
      refPath: fila.refPath || '',
      ofreceUid: fila.ofreceUid || '',
      buscaUid: fila.buscaUid || '',
    })
      .then((r) => { if (vivo) setDatos((r.data || {}) as never); })
      .catch((e) => { if (vivo) setError(mensajeDeError(e, 'No pudimos abrir la operación.')); });
    return () => { vivo = false; };
  }, [fila.refPath, fila.ofreceUid, fila.buscaUid]);

  const plata = (n?: number) => `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;

  return (
    <section className="admin-seccion">
      <button type="button" className="btn btn-outline" onClick={alVolver}>Volver al registro</button>

      <h2 style={{ marginTop: 12 }}>{fila.detalle || 'Operación'}</h2>
      <p className="admin-sub">
        {plata(fila.precio)} · comisión {plata(fila.comision)} · {fila.refPath}
      </p>

      {!!error && <p className="admin-error-inline">{error}</p>}

      {!error && datos === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : !error && (
        <>
          <Parte titulo="Ofrece" persona={datos?.ofrece || null} />
          <Parte titulo="Busca" persona={datos?.busca || null} />
          {!!datos?.operacion && (
            <div className="admin-caso">
              <strong>El documento de la operación</strong>
              <pre className="admin-json">{JSON.stringify(datos.operacion, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}
