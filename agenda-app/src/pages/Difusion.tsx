import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import { ventanaDeLosUltimos, type Ventana } from '../utils/diaOperativo';

// QUÉ MENSAJE ESTÁ GANANDO EN CADA PLATAFORMA.
//
// Cada mensaje de la campaña directa lleva dos links con su propio `?ref=`:
// `m-wpp-o1-web` es el mensaje 1 de oferta, mandado por WhatsApp, link a la
// portada. Acá se ve cuánta gente tocó cada uno.
//
// QUÉ SIGNIFICA "GANAR". Que alguien tocó uno de sus dos links. NO es cuánta
// gente se registró: la cadena se corta cuando el teléfono salta a la tienda.
// Pero es lo único que compara un texto contra otro en igualdad de
// condiciones, que es justo la pregunta —de los que escribimos, ¿cuál hace que
// alguien quiera mirar?
//
// LOS DOS LINKS VAN SEPARADOS a propósito: `web` es el que quiere entender
// antes de instalar nada, `app` el que va derecho a la tienda. Sumados, la
// diferencia se pierde.
//
// LA MATRIZ LA ARMA EL BACKEND (`verDifusion`), no esta pantalla. Hay dos
// paneles —éste y el del celular— y si cada uno agrupara por su cuenta, el
// primer cambio los desincroniza.
//
// Es la misma pantalla que la solapa "Difusión" de la app
// (src/screens/panel/Difusion.tsx).

type Celda = { web: number; app: number };
type Fila = {
  proposito: string;
  numero: number;
  texto: string | null;
  total: number;
  porPlataforma: Record<string, Celda>;
};
type Datos = {
  desdeSiempre: boolean;
  truncado: boolean;
  total: number;
  toques: Record<string, number>;
  plataformas: Array<{ clave: string; nombre: string }>;
  propositos: Array<{ clave: string; nombre: string }>;
  filas: Fila[];
};

// Las mismas ventanas que el resto del panel, de 2:00 a 2:00.
const ATAJOS: Array<{ key: string; label: string; ventana: () => Ventana }> = [
  { key: 'todo', label: 'Desde siempre', ventana: () => null },
  { key: '7', label: '7 días', ventana: () => ventanaDeLosUltimos(7) },
  { key: '30', label: '30 días', ventana: () => ventanaDeLosUltimos(30) },
];

export default function Difusion() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [atajo, setAtajo] = useState('todo');
  const [abierto, setAbierto] = useState<string>('');

  const cargar = useCallback(async (clave: string) => {
    setCargando(true);
    setError('');
    const v = (ATAJOS.find((a) => a.key === clave) || ATAJOS[0]).ventana();
    try {
      const r = await httpsCallable(functions, 'verDifusion')({
        desdeMillis: v?.desde,
        hastaMillis: v?.hasta,
      });
      setDatos((r?.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo leer la difusión.'));
      setDatos(null);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(atajo); }, [cargar, atajo]);

  // QUIÉN GANA EN CADA COLUMNA. Se calcula acá y no en el backend porque es
  // una propiedad de lo que se está mirando, no del dato: cambiar la ventana
  // puede cambiar el ganador sin que cambie ni un número de la tabla.
  //
  // Un empate NO tiene ganador. Marcar a los dos diría que los dos ganan, y
  // marcar al primero sería inventar un orden que no existe.
  const ganadores = useMemo(() => {
    const g: Record<string, string> = {};
    if (!datos) return g;
    for (const p of datos.plataformas) {
      let mejor = 0;
      let clave = '';
      let empate = false;
      for (const f of datos.filas) {
        const c = f.porPlataforma[p.clave];
        const n = c ? c.web + c.app : 0;
        if (n > mejor) { mejor = n; clave = `${f.proposito}${f.numero}`; empate = false; }
        else if (n === mejor && n > 0) empate = true;
      }
      if (mejor > 0 && !empate) g[p.clave] = clave;
    }
    return g;
  }, [datos]);

  const nombreDelProposito = (clave: string) =>
    datos?.propositos.find((p) => p.clave === clave)?.nombre || clave;

  if (cargando && !datos) return <p className="admin-sub">Cargando…</p>;

  return (
    <div>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Cuánta gente tocó los links de cada mensaje. No son registros: la cuenta
        se corta cuando el teléfono salta a la tienda. Sirve para comparar un
        texto contra otro, que es lo único que no se puede saber de otra forma.
      </p>

      {error && <p className="admin-error-inline">{error}</p>}

      <div className="ledger-filtros">
        {ATAJOS.map((a) => (
          <button
            key={a.key}
            type="button"
            className={`ledger-chip${a.key === atajo ? ' ledger-chip-activo' : ''}`}
            onClick={() => setAtajo(a.key)}
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          className="ledger-chip"
          onClick={() => { void cargar(atajo); }}
        >
          Actualizar
        </button>
      </div>

      {datos?.truncado && (
        <p className="admin-sub">
          Hay más toques de los que se leyeron en esta ventana: lo de abajo es
          una parte, no el total. Para el número exacto, mirá «Desde siempre».
        </p>
      )}

      {!datos || datos.filas.length === 0 ? (
        <div className="admin-card">
          <p className="admin-sub">
            Todavía no hay ningún toque registrado.
            {' '}
            Aparecen acá en cuanto alguien abra uno de los links de los
            mensajes. Si ya mandaste alguno y esto sigue vacío, abrí vos mismo
            un link desde el teléfono: tendría que sumar uno.
          </p>
        </div>
      ) : (
        <>
          <div className="admin-card">
            <h3>{datos.total} {datos.total === 1 ? 'toque' : 'toques'}</h3>
            <p className="admin-sub">
              {datos.desdeSiempre
                ? 'Desde que se empezó a medir mensaje por mensaje.'
                : 'En la ventana elegida.'}
            </p>
          </div>

          {datos.filas.map((f) => {
            const clave = `${f.proposito}${f.numero}`;
            return (
              <div className="admin-card" key={clave}>
                <h3>
                  Mensaje {f.numero}
                  <span className="admin-sub"> · {nombreDelProposito(f.proposito)}</span>
                </h3>
                <p className="admin-sub">
                  {f.total} {f.total === 1 ? 'toque' : 'toques'} en total
                </p>

                <ul className="admin-lista">
                  {datos.plataformas.map((p) => {
                    const c = f.porPlataforma[p.clave] || { web: 0, app: 0 };
                    const n = c.web + c.app;
                    const gana = ganadores[p.clave] === clave;
                    return (
                      <li key={p.clave}>
                        <strong>{p.nombre}</strong>
                        {' '}
                        <strong>{n}</strong>
                        <span className="admin-sub">
                          {' '}· web {c.web} · app {c.app}
                        </span>
                        {gana && (
                          <span className="ledger-chip ledger-chip-activo" style={{ marginLeft: 8 }}>
                            el que más trae
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>

                {f.texto && (
                  <>
                    <button
                      type="button"
                      className="ledger-chip"
                      onClick={() => setAbierto((a) => (a === clave ? '' : clave))}
                    >
                      {abierto === clave ? 'Ocultar' : 'Ver'} el texto
                    </button>
                    {abierto === clave && (
                      <div
                        style={{
                          whiteSpace: 'pre-wrap', marginTop: 8,
                          fontSize: '.9rem', lineHeight: 1.5,
                        }}
                      >
                        {f.texto}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
