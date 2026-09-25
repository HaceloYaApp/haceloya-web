import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import { SECCIONES_DEL_CATALOGO } from '../utils/seccionesDelCatalogo';
import './LedgerPage.css';

// ALTA DE SECCIONES, EN LA WEB (25/09/2026).
//
// El espejo de la pestaña del panel del celular, por la regla del proyecto: lo
// que se hace desde uno tiene que poder hacerse desde el otro.
//
// DOS FUENTES DISTINTAS, Y NO ES UN CAPRICHO:
//
//  · Del lado PROFESIONAL hay solicitudes: alguien pide que se agregue algo y
//    queda esperando. Se resuelven acá.
//  · Del lado MARKET no hay nada que esperar. Desde el 24/08/2026 quien
//    publica crea su categoría en el momento, validada. Lo que se hace acá es
//    mirarlas y tapar la que no corresponda — `taparCategoriaDeMarket` existía
//    desde entonces y ninguna pantalla lo llamaba.
//
// LO QUE ESTA PANTALLA NO PUEDE HACER Y LA DEL CELULAR SÍ: avisar "esto ya
// está en el catálogo". Las 583 entradas viven en el binario de la app, y acá
// no están. Sí están las 48 SECCIONES (copia generada), que es lo que hace
// falta para ubicar un alta.

type Solicitud = {
  id: string; name: string; type: string; ambito: string;
  seccion: string | null; seccionNueva: string | null;
  notes: string | null; requesterEmail: string | null; createdAt: number;
};

type CategoriaDeMarket = {
  id: string; clave: string; titulo: string; padre: string;
  creadaPor: string; oculta: boolean; createdAt: number;
};

const TIPOS_PROFESIONAL = [
  { key: 'oficio', label: 'Oficio / servicio' },
  { key: 'actividad', label: 'Actividad' },
  { key: 'turno', label: 'Turno' },
  { key: 'puesto', label: 'Puesto del CV' },
];

/** Igual que claveDesdeNombre en el repo de la app. */
const claveDesde = (nombre: string) => nombre
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

const CLAVE_OK = (k: string) => /^[a-z0-9_]{2,60}$/.test(k);

export default function AltaDeSeccionesPanel() {
  const [ambito, setAmbito] = useState<'profesional' | 'market'>('profesional');
  const [estado, setEstado] = useState<'pending' | 'resuelta' | 'descartada'>('pending');
  const [items, setItems] = useState<Solicitud[] | null>(null);
  const [categorias, setCategorias] = useState<CategoriaDeMarket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);

  // Lo que se está resolviendo, para la solicitud abierta.
  const [tipo, setTipo] = useState('oficio');
  const [titulo, setTitulo] = useState('');
  const [clave, setClave] = useState('');
  const [seccion, setSeccion] = useState('');
  const [seccionNueva, setSeccionNueva] = useState(false);
  const [tituloSeccion, setTituloSeccion] = useState('');

  const cargar = useCallback(async () => {
    setItems(null); setCategorias(null); setError(null);
    try {
      if (ambito === 'market') {
        const r: any = await httpsCallable(functions, 'listarCategoriasDeMarket')({});
        setCategorias((r?.data?.items || []) as CategoriaDeMarket[]);
        return;
      }
      const r: any = await httpsCallable(functions, 'listarSolicitudesDeAlta')({ estado, ambito });
      setItems((r?.data?.items || []) as Solicitud[]);
    } catch (e) {
      setItems([]); setCategorias([]);
      setError(mensajeDeError(e, 'No se pudo cargar. Probá de nuevo.'));
    }
  }, [ambito, estado]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrir = (s: Solicitud) => {
    if (abierta === s.id) { setAbierta(null); return; }
    setAbierta(s.id);
    setTipo(TIPOS_PROFESIONAL.some((t) => t.key === s.type) ? s.type : 'oficio');
    setTitulo(s.name || '');
    setClave(claveDesde(s.name || ''));
    setSeccion(s.seccion || '');
    setSeccionNueva(!!s.seccionNueva);
    setTituloSeccion(s.seccionNueva || '');
  };

  const resolver = async (datos: any) => {
    setTrabajando(true); setError(null);
    try {
      await httpsCallable(functions, 'resolverSolicitudDeAlta')(datos);
      setAbierta(null);
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo. Probá de nuevo.'));
    } finally {
      setTrabajando(false);
    }
  };

  const agregar = (id: string) => {
    if (!CLAVE_OK(clave)) {
      setError('La clave lleva sólo minúsculas, números y guión bajo, de 2 a 60 caracteres.');
      return;
    }
    if (!titulo.trim()) { setError('Falta el nombre que se va a mostrar.'); return; }
    if (seccionNueva && !tituloSeccion.trim()) { setError('Falta el nombre de la sección nueva.'); return; }
    const claveSeccion = seccionNueva ? claveDesde(tituloSeccion) : seccion;
    const ok = window.confirm(
      `Agregar "${titulo}" al catálogo.\n\nClave: ${clave}\nTipo: ${tipo}\n`
      + (seccionNueva ? `Sección NUEVA: ${tituloSeccion}` : `Sección: ${seccion || '(sin sección)'}`)
      + '\n\nLa clave no se va a poder cambiar después.',
    );
    if (!ok) return;
    resolver({
      id, accion: 'agregar', tipo, key: clave, title: titulo.trim(),
      rubro: claveSeccion || null,
      rubroNuevoTitulo: seccionNueva ? tituloSeccion.trim() : '',
    });
  };

  const tapar = async (id: string, oculta: boolean) => {
    setTrabajando(true); setError(null);
    try {
      await httpsCallable(functions, 'taparCategoriaDeMarket')({ id, oculta });
      await cargar();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo. Probá de nuevo.'));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <section className="admin-card">
      <nav className="ledger-filtros" aria-label="Ámbito">
        {(['profesional', 'market'] as const).map((a) => (
          <button
            key={a}
            type="button"
            className={`ledger-chip${ambito === a ? ' ledger-chip-activo' : ''}`}
            aria-pressed={ambito === a}
            onClick={() => { setAmbito(a); setAbierta(null); }}
          >
            {a === 'profesional' ? 'Profesional' : 'Market'}
          </button>
        ))}
      </nav>

      {/* Los estados son de las solicitudes. En market no hay solicitud: la
          categoría ya está creada y lo único que se decide es si se tapa. */}
      {ambito !== 'market' && (
        <nav className="ledger-filtros" aria-label="Estado">
          {([['pending', 'Nuevas'], ['resuelta', 'Agregadas'], ['descartada', 'Descartadas']] as const).map(([k, t]) => (
            <button
              key={k}
              type="button"
              className={`ledger-chip${estado === k ? ' ledger-chip-activo' : ''}`}
              aria-pressed={estado === k}
              onClick={() => { setEstado(k); setAbierta(null); }}
            >
              {t}
            </button>
          ))}
        </nav>
      )}

      {error && <p className="admin-error-inline">{error}</p>}

      {ambito === 'market' ? (
        categorias === null ? <p className="admin-loading">Cargando…</p>
          : categorias.length === 0 ? <p className="admin-sub">Nadie creó ninguna categoría todavía.</p>
            : (
              <>
                <p className="admin-sub">
                  Estas las creó la gente al publicar. Ya están en uso: acá se tapan si no
                  corresponden. Taparlas las saca del selector y de los filtros, y las
                  publicaciones que ya estaban siguen andando.
                </p>
                <ul className="admin-lista">
                  {categorias.map((c) => (
                    <li key={c.id}>
                      <strong>{c.titulo}</strong>{' '}
                      <span className="admin-sub">
                        {c.padre ? `subcategoría de ${c.padre}` : 'categoría'} · {c.clave}
                        {c.oculta ? ' · TAPADA' : ''}
                      </span>{' '}
                      <button type="button" className="btn btn-outline" disabled={trabajando}
                        onClick={() => tapar(c.id, !c.oculta)}>
                        {c.oculta ? 'Destapar' : 'Tapar'}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )
      ) : items === null ? <p className="admin-loading">Cargando…</p>
        : items.length === 0 ? <p className="admin-sub">No hay nada pendiente acá.</p>
          : (
            <ul className="admin-lista">
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" className="ledger-chip" onClick={() => abrir(s)}>
                    <strong>{s.name}</strong>{' '}
                    <span className="admin-sub">
                      {s.type}
                      {s.seccion ? ` · sección pedida: ${s.seccion}` : ''}
                      {s.seccionNueva ? ` · propone sección: ${s.seccionNueva}` : ''}
                    </span>
                  </button>
                  {!!s.notes && <p className="admin-sub">“{s.notes}”</p>}

                  {abierta === s.id && estado === 'pending' && (
                    <div className="admin-card" style={{ marginTop: 10 }}>
                      <label>
                        En qué catálogo va
                        <select value={tipo} onChange={(e) => { setTipo(e.target.value); setSeccion(''); }}>
                          {TIPOS_PROFESIONAL.map((t) => (
                            <option key={t.key} value={t.key}>{t.label}</option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Nombre que se muestra
                        <input
                          type="text"
                          value={titulo}
                          onChange={(e) => {
                            setTitulo(e.target.value);
                            if (!CLAVE_OK(clave)) setClave(claveDesde(e.target.value));
                          }}
                        />
                      </label>

                      <label>
                        Clave (no se puede cambiar después)
                        <input type="text" value={clave} onChange={(e) => setClave(e.target.value)} />
                      </label>

                      <label>
                        <input
                          type="checkbox"
                          checked={seccionNueva}
                          onChange={(e) => setSeccionNueva(e.target.checked)}
                        />{' '}
                        La sección no existe, la creo ahora
                      </label>

                      {seccionNueva ? (
                        <label>
                          Nombre de la sección nueva
                          <input
                            type="text"
                            value={tituloSeccion}
                            onChange={(e) => setTituloSeccion(e.target.value)}
                          />
                        </label>
                      ) : (
                        <label>
                          En qué sección
                          <select value={seccion} onChange={(e) => setSeccion(e.target.value)}>
                            <option value="">(sin sección)</option>
                            {(SECCIONES_DEL_CATALOGO[tipo] || []).map((nombre) => (
                              <option key={nombre} value={claveDesde(nombre)}>{nombre}</option>
                            ))}
                          </select>
                        </label>
                      )}

                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button type="button" className="btn" disabled={trabajando}
                          onClick={() => agregar(s.id)}>
                          Agregar al catálogo
                        </button>
                        <button type="button" className="btn btn-outline" disabled={trabajando}
                          onClick={() => resolver({ id: s.id, accion: 'descartar' })}>
                          Descartar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
    </section>
  );
}
