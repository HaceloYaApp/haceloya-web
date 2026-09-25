import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './LedgerPage.css';

// MARCA Y MODELO DEL MARKET (pedido suyo, 25/09/2026).
//
// Las crea quien publica, sin pasar por revisión: pedirle que espere una
// aprobación para poder decir "Makita" es perderle la publicación. El control
// es posterior, y es esta pantalla.
//
// EL CASO QUE ESTO VIENE A RESOLVER es el duplicado mal escrito: "Makita" y
// "Maquita" conviviendo en la misma lista. Por eso acá se puede EDITAR el
// nombre y BORRAR, que es distinto de las categorías del market —esas se
// tapan—. Tapar un duplicado lo dejaría adentro de la lista para siempre, y
// lo que se busca es justamente que no queden dos.
//
// Se agrupa por rubro porque las marcas son POR RUBRO: las de Herramientas no
// tienen nada que ver con las de Indumentaria, y mezcladas no se puede
// comparar nada.

type Marca = {
  id: string; categoria: string; clave: string; titulo: string;
  padre: string; creadaPor: string; createdAt: number;
};

/** Sin tildes ni mayúsculas: es como se detecta que dos son casi la misma. */
const normal = (s: string) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Distancia de edición, para marcar los sospechosos de estar repetidos. */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length; const n = b.length;
  if (Math.abs(m - n) > 2) return 9;
  const fila = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let previo = fila[0];
    fila[0] = i;
    for (let j = 1; j <= n; j++) {
      const guardado = fila[j];
      fila[j] = a[i - 1] === b[j - 1]
        ? previo
        : 1 + Math.min(previo, fila[j], fila[j - 1]);
      previo = guardado;
    }
  }
  return fila[n];
}

export default function MarcasYModelosPanel() {
  const [items, setItems] = useState<Marca[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [nuevoTitulo, setNuevoTitulo] = useState('');

  const cargar = useCallback(async () => {
    setItems(null); setError(null);
    try {
      const r: any = await httpsCallable(functions, 'listarMarcasDeMarket')({});
      setItems((r?.data?.items || []) as Marca[]);
    } catch (e) {
      setItems([]);
      setError(mensajeDeError(e, 'No se pudo cargar. Probá de nuevo.'));
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // Los que se parecen demasiado dentro del mismo rubro y el mismo padre.
  // Es lo que hace que un "Maquita" salte a la vista sin leer 300 nombres.
  const sospechosos = useMemo(() => {
    const marcados = new Set<string>();
    const lista = items || [];
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i]; const b = lista[j];
        if (a.categoria !== b.categoria || a.padre !== b.padre) continue;
        if (distancia(normal(a.titulo), normal(b.titulo)) <= 2) {
          marcados.add(a.id); marcados.add(b.id);
        }
      }
    }
    return marcados;
  }, [items]);

  const porRubro = useMemo(() => {
    const mapa = new Map<string, Marca[]>();
    for (const m of items || []) {
      const lista = mapa.get(m.categoria) || [];
      lista.push(m);
      mapa.set(m.categoria, lista);
    }
    return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [items]);

  const guardar = async (id: string) => {
    if (nuevoTitulo.trim().length < 2) { setError('El nombre es muy corto.'); return; }
    setTrabajando(true); setError(null);
    try {
      await httpsCallable(functions, 'editarMarcaDeMarket')({ id, titulo: nuevoTitulo.trim() });
      setEditando(null);
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo guardar.'));
    } finally { setTrabajando(false); }
  };

  const borrar = async (m: Marca) => {
    const esMarca = !m.padre;
    const ok = window.confirm(
      `Borrar "${m.titulo}".\n\n`
      + (esMarca
        ? 'Es una MARCA: se borran también todos sus modelos.\n\n'
        : '')
      + 'Las publicaciones que ya la eligieron congelaron su texto al publicarse,'
      + ' así que siguen diciendo lo mismo. Lo que se pierde es que aparezca al publicar.',
    );
    if (!ok) return;
    setTrabajando(true); setError(null);
    try {
      const r: any = await httpsCallable(functions, 'borrarMarcaDeMarket')({ id: m.id });
      const n = Number(r?.data?.modelosBorrados || 0);
      if (n > 0) setError(`Listo: se borró junto con ${n} ${n === 1 ? 'modelo' : 'modelos'}.`);
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo borrar.'));
    } finally { setTrabajando(false); }
  };

  return (
    <section className="admin-card">
      <p className="admin-sub">
        Las crea quien publica, sin revisión. Acá se corrigen los nombres mal escritos y
        se borran los repetidos. Están agrupadas por rubro, porque las marcas son por rubro.
      </p>
      {sospechosos.size > 0 && (
        <p className="admin-sub">
          <strong>{sospechosos.size}</strong> están marcadas como posibles repetidas: se
          escriben casi igual que otra del mismo rubro.
        </p>
      )}

      {error && <p className="admin-error-inline">{error}</p>}

      {items === null ? <p className="admin-loading">Cargando…</p>
        : items.length === 0 ? <p className="admin-sub">Todavía no hay ninguna marca cargada.</p>
          : porRubro.map(([rubro, lista]) => (
            <div key={rubro} style={{ marginTop: 16 }}>
              <h3>{rubro}</h3>
              <ul className="admin-lista">
                {lista.filter((m) => !m.padre).map((marca) => (
                  <li key={marca.id}>
                    {editando === marca.id ? (
                      <>
                        <input type="text" value={nuevoTitulo}
                          onChange={(e) => setNuevoTitulo(e.target.value)} />
                        <button type="button" className="btn" disabled={trabajando}
                          onClick={() => guardar(marca.id)}>Guardar</button>
                        <button type="button" className="btn btn-outline"
                          onClick={() => setEditando(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <strong>{marca.titulo}</strong>
                        {sospechosos.has(marca.id) && (
                          <span className="admin-sub"> · ¿repetida?</span>
                        )}
                        <span className="admin-sub"> · {marca.clave}</span>{' '}
                        <button type="button" className="btn btn-outline" disabled={trabajando}
                          onClick={() => { setEditando(marca.id); setNuevoTitulo(marca.titulo); }}>
                          Editar
                        </button>{' '}
                        <button type="button" className="btn btn-outline" disabled={trabajando}
                          onClick={() => borrar(marca)}>Borrar</button>
                      </>
                    )}

                    {/* Los modelos de esa marca, adentro. */}
                    <ul className="admin-lista">
                      {lista.filter((m) => m.padre === marca.clave).map((modelo) => (
                        <li key={modelo.id}>
                          {editando === modelo.id ? (
                            <>
                              <input type="text" value={nuevoTitulo}
                                onChange={(e) => setNuevoTitulo(e.target.value)} />
                              <button type="button" className="btn" disabled={trabajando}
                                onClick={() => guardar(modelo.id)}>Guardar</button>
                              <button type="button" className="btn btn-outline"
                                onClick={() => setEditando(null)}>Cancelar</button>
                            </>
                          ) : (
                            <>
                              {modelo.titulo}
                              {sospechosos.has(modelo.id) && (
                                <span className="admin-sub"> · ¿repetido?</span>
                              )}{' '}
                              <button type="button" className="btn btn-outline" disabled={trabajando}
                                onClick={() => { setEditando(modelo.id); setNuevoTitulo(modelo.titulo); }}>
                                Editar
                              </button>{' '}
                              <button type="button" className="btn btn-outline" disabled={trabajando}
                                onClick={() => borrar(modelo)}>Borrar</button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          ))}
    </section>
  );
}
