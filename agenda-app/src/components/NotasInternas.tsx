import { useEffect, useState } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, deleteDoc, doc, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// NOTAS INTERNAS DE UNA CUENTA (hallazgo 26 del 23/09/2026).
//
// La misma que el panel de la app, porque lo que se hace desde el celular
// tiene que poder hacerse desde la web y al revés.
//
// No la lee su dueño: es memoria del equipo entre turnos, no un mensaje para
// quien usa la app. Va firmada y fechada, y no se edita — la corrección es
// otra nota. Quien manda es firestore.rules; esto es sólo la pantalla.
type Nota = { id: string; texto?: string; autorUid?: string; autorNombre?: string; creadoEn?: any };

export default function NotasInternas({ uid }: { uid: string }) {
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [texto, setTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'users', uid, 'notasInternas'), orderBy('creadoEn', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => setNotas(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (e) => { setError(mensajeDeError(e, 'No pudimos leer las notas.')); setNotas([]); },
    );
    return () => unsub();
  }, [uid]);

  const agregar = async () => {
    const limpio = texto.trim();
    const yo = auth.currentUser;
    if (!limpio || !yo) return;
    setGuardando(true);
    setError('');
    try {
      await addDoc(collection(db, 'users', uid, 'notasInternas'), {
        texto: limpio.slice(0, 2000),
        autorUid: yo.uid,
        autorNombre: yo.displayName || yo.email || '',
        creadoEn: serverTimestamp(),
      });
      setTexto('');
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo guardar la nota.'));
    } finally {
      setGuardando(false);
    }
  };

  const borrar = async (id: string) => {
    if (!window.confirm('¿Borrar esta nota? Si querés corregirla, escribí otra: así queda el historial.')) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'notasInternas', id));
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo borrar la nota.'));
    }
  };

  return (
    <div className="notas-internas">
      <strong>Notas internas</strong>
      <p className="admin-sub">Sólo las ve el equipo. Esta persona no las lee.</p>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Ej: llamó por la denuncia del 12, quedó en mandar la factura"
        aria-label="Escribir una nota interna sobre esta cuenta"
      />
      <button type="button" className="btn" disabled={guardando || !texto.trim()} onClick={agregar}>
        {guardando ? 'Guardando...' : 'Agregar nota'}
      </button>
      {!!error && <p className="admin-error">{error}</p>}
      {notas === null ? (
        <p className="admin-sub">Cargando...</p>
      ) : notas.length === 0 ? (
        <p className="admin-sub">Todavía no hay notas sobre esta cuenta.</p>
      ) : (
        <ul className="admin-lista">
          {notas.map((n) => (
            <li key={n.id}>
              <span>{n.texto}</span>
              <span className="admin-sub">
                {n.autorNombre || n.autorUid || 'alguien del equipo'}
                {n.creadoEn?.toDate ? ` · ${n.creadoEn.toDate().toLocaleString('es-AR')}` : ''}
              </span>
              <button type="button" className="btn btn-sutil" onClick={() => borrar(n.id)}>
                Borrar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
