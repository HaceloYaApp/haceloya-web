import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// DE DÓNDE VIENE LA GENTE.
//
// Cada pieza impresa lleva un QR distinto que apunta a
// `haceloya.com/ir/?ref=<canal>`. Al escanearlo, esa página avisa al backend
// antes de mandar el teléfono a la tienda. Acá se ve el resultado: cuánta gente
// entró desde el afiche amarillo, cuánta desde el tótem de tal ferretería.
//
// LO QUE ESTE NÚMERO ES Y LO QUE NO ES. Son ESCANEOS, no descargas. La cadena
// se corta cuando el teléfono salta a la tienda, así que esto dice cuánta gente
// se interesó, no cuánta se instaló la app. Aun así es el número que sirve para
// decidir: es el único que compara una pieza contra otra en igualdad de
// condiciones.
//
// Es la misma pantalla que la pestaña Marketing de la app
// (src/screens/panel/Marketing.tsx). Lo que se puede hacer desde el teléfono
// tiene que poder hacerse desde la compu, y al revés.

type Datos = {
  total: number;
  canales: Record<string, number>;
  nombres: Record<string, string>;
  porDia: Array<{ dia: string; total: number }>;
  locales: Array<{ local: string; total: number }>;
};

/** 'ferreteria-lopez' → 'Ferreteria lopez' */
function legible(local: string): string {
  const t = local.replace(/-/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** '2026-09-21' → '21/09' */
function diaCorto(dia: string): string {
  const [, m, d] = dia.split('-');
  return d && m ? `${d}/${m}` : dia;
}

export default function MarketingPanel() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await httpsCallable(functions, 'verMarketing')({ dias: 30 });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron leer las visitas.'));
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const canales = Object.entries(datos?.canales || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const mayor = canales.length ? canales[0][1] : 0;
  const hoy = datos?.porDia?.[0];

  return (
    <>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Cuánta gente entró desde cada pieza impresa. Son escaneos de QR, no descargas:
        la cuenta se corta cuando el teléfono salta a la tienda.
      </p>

      {error && <p className="admin-error-inline">{error}</p>}
      {cargando && !datos && <p className="admin-loading">Cargando…</p>}

      {datos && (
        <>
          <div className="admin-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{datos.total}</div>
                <div className="admin-sub">escaneos en total</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{hoy?.total ?? 0}</div>
                <div className="admin-sub">hoy</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{canales.length}</div>
                <div className="admin-sub">piezas con al menos uno</div>
              </div>
            </div>
          </div>

          <div className="admin-card">
            <h3>Por pieza</h3>
            {canales.length === 0 ? (
              <p className="admin-sub">
                Todavía no hay ningún escaneo. Va a aparecer acá en cuanto alguien apunte
                el teléfono a un QR impreso.
              </p>
            ) : (
              <ul className="admin-lista">
                {canales.map(([canal, n]) => (
                  <li key={canal} style={{ display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>{datos.nombres?.[canal] || canal}</span>
                      <strong>{n}</strong>
                    </div>
                    {/* La barra se mide contra la pieza que más trajo, no contra
                        el total: lo que interesa es comparar una con otra. */}
                    <div style={{ height: 6, borderRadius: 3, background: 'rgba(127,127,127,.25)', marginTop: 6 }}>
                      <div style={{
                        height: 6, borderRadius: 3, background: 'var(--accent, #F2C94C)',
                        width: `${mayor ? Math.max(3, (n / mayor) * 100) : 0}%`,
                      }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {datos.locales?.length > 0 && (
            <div className="admin-card">
              <h3>Por local</h3>
              <p className="admin-sub">
                Los tótems con el nombre del comercio adentro del QR. Es el único número que
                dice a qué mostrador volver con cinco más.
              </p>
              <ul className="admin-lista">
                {datos.locales.map((l) => (
                  <li key={l.local}>
                    <span>{legible(l.local)}</span>
                    <strong>{l.total}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {datos.porDia?.length > 0 && (
            <div className="admin-card">
              <h3>Día por día</h3>
              <ul className="admin-lista">
                {datos.porDia.map((d) => (
                  <li key={d.dia}>
                    <span>{diaCorto(d.dia)}</span>
                    <strong>{d.total}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );
}
