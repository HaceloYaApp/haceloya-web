import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// DÓNDE ESTÁ PASANDO ALGO.
//
// Dónde viven los profesionales anotados y dónde se publican los pedidos. No es
// el mapa de los afiches —ése lo sabe el papel— es el que sirve para decidir
// dónde gastar en publicidad y a qué barrio ir a buscar oficios.
//
// SIN MAPA DE FONDO, Y ES A PROPÓSITO. Poner calles pediría cargar mosaicos de
// un servidor de terceros, y la CSP del sitio no lo permite (`img-src 'self'`):
// habría que abrirla para que un tercero vea desde qué zonas mira el panel un
// administrador. Las celdas solas igual muestran la forma de lo que hay —se
// reconoce la mancha de la ciudad— y para ubicar una zona puntual está el link
// que abre ese punto en Google Maps, que es más preciso que mirar un dibujito.

type Celda = { lat: number; lon: number; usuarios: number; profesionales: number; pedidos: number };
type Datos = {
  celdas: Celda[];
  grillaMetros: number;
  dias: number;
  truncado: boolean;
  totales: {
    usuarios: number; profesionales: number; pedidos: number;
    sinUbicacion: number; pedidosSinUbicacion: number; zonas: number; huecos: number;
  };
};

const LADO = 420;   // px del cuadro donde se dibuja

export default function MapaDensidad() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await httpsCallable(functions, 'verMapaDeDensidad')({ dias: 90 });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo armar el mapa.'));
      setDatos(null);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  if (cargando && !datos) return <p className="admin-loading">Armando el mapa…</p>;
  if (error) return <p className="admin-error-inline">{error}</p>;
  if (!datos || datos.celdas.length === 0) {
    return (
      <div className="admin-card">
        <h3>Dónde está pasando algo</h3>
        <p className="admin-sub">
          Todavía no hay ninguna cuenta con dirección cargada, así que no hay nada que
          dibujar. Va a aparecer solo a medida que la gente complete su perfil.
        </p>
      </div>
    );
  }

  const cs = datos.celdas;
  const lats = cs.map((c) => c.lat), lons = cs.map((c) => c.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  // Un margen para que las celdas del borde no queden cortadas al medio.
  const spanLat = Math.max(maxLat - minLat, 0.01) * 1.1;
  const spanLon = Math.max(maxLon - minLon, 0.01) * 1.1;
  const cx = (minLat + maxLat) / 2, cy = (minLon + maxLon) / 2;
  // La escala la manda el lado más grande: así no se deforma la ciudad.
  const span = Math.max(spanLat, spanLon);
  const px = (lat: number, lon: number) => ({
    // La latitud crece hacia arriba y la pantalla hacia abajo: por eso va al revés.
    top: ((cx + span / 2 - lat) / span) * LADO,
    left: ((lon - (cy - span / 2)) / span) * LADO,
  });
  const maxAct = Math.max(...cs.map((c) => c.usuarios + c.pedidos), 1);
  const lado = Math.max(3, (datos.grillaMetros / 111_320 / span) * LADO);

  const huecos = cs.filter((c) => c.pedidos > 0 && c.profesionales === 0)
    .sort((a, b) => b.pedidos - a.pedidos);
  const zonas = [...cs].sort((a, b) => (b.usuarios + b.pedidos) - (a.usuarios + a.pedidos));
  const mapa = (c: Celda) => `https://www.google.com/maps?q=${c.lat},${c.lon}`;

  return (
    <>
      <div className="admin-card">
        <h3>Dónde está pasando algo</h3>
        <p className="admin-sub">
          Los profesionales anotados y los pedidos de los últimos {datos.dias} días, sobre la
          grilla de {datos.grillaMetros} m. Es el mapa que sirve para decidir dónde poner
          publicidad y a qué barrio ir a buscar oficios.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{datos.totales.profesionales}</div>
            <div className="admin-sub">profesionales</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{datos.totales.pedidos}</div>
            <div className="admin-sub">pedidos en {datos.dias} días</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{datos.totales.zonas}</div>
            <div className="admin-sub">zonas con alguien</div>
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{datos.totales.huecos}</div>
            <div className="admin-sub">zonas con pedidos y sin nadie</div>
          </div>
        </div>
        {datos.totales.sinUbicacion > 0 && (
          <p className="admin-sub" style={{ marginTop: 12 }}>
            {datos.totales.sinUbicacion} cuenta(s) sin dirección cargada no entran en el mapa.
          </p>
        )}
      </div>

      <div className="admin-card">
        <h3>El dibujo</h3>
        <p className="admin-sub">
          Sin calles de fondo a propósito: los mosaicos de un mapa los sirve un tercero y la
          CSP del sitio no lo permite. Cada cuadrito es una celda de {datos.grillaMetros} m;
          cuanto más fuerte, más movimiento. Los <b style={{ color: '#E5007E' }}>rosas</b> son
          zonas con pedidos y ningún profesional.
        </p>
        <div style={{
          position: 'relative', width: LADO, height: LADO, maxWidth: '100%',
          border: '1px solid var(--border, #ccc)', borderRadius: 4, marginTop: 12,
          overflow: 'hidden',
        }}
        >
          {cs.map((c) => {
            const { top, left } = px(c.lat, c.lon);
            const hueco = c.pedidos > 0 && c.profesionales === 0;
            const fuerza = Math.min(1, (c.usuarios + c.pedidos) / maxAct);
            return (
              <a
                key={`${c.lat},${c.lon}`}
                href={mapa(c)}
                target="_blank"
                rel="noreferrer"
                title={`${c.profesionales} profesional(es) · ${c.pedidos} pedido(s)`}
                style={{
                  position: 'absolute', top: top - lado / 2, left: left - lado / 2,
                  width: lado, height: lado, borderRadius: 1,
                  background: hueco ? '#E5007E' : 'currentColor',
                  opacity: hueco ? 0.9 : 0.25 + fuerza * 0.65,
                }}
              />
            );
          })}
        </div>
        <p className="admin-sub" style={{ marginTop: 8 }}>
          Tocá un cuadrito para abrir esa zona en Google Maps.
        </p>
      </div>

      {huecos.length > 0 && (
        <div className="admin-card">
          <h3>Pedidos sin nadie cerca</h3>
          <p className="admin-sub">
            Zonas donde alguien pidió algo y no hay ningún profesional anotado. Es lo más caro
            que le puede pasar a la app: el que publica y no recibe ni un presupuesto no
            vuelve, y encima lo cuenta. Cada una de éstas es una mañana de ronda con destino.
          </p>
          <ul className="admin-lista">
            {huecos.slice(0, 15).map((c) => (
              <li key={`h${c.lat},${c.lon}`}>
                <a href={mapa(c)} target="_blank" rel="noreferrer">
                  {c.lat.toFixed(4)}, {c.lon.toFixed(4)} — ver en el mapa
                </a>
                <strong>{c.pedidos} pedido{c.pedidos === 1 ? '' : 's'}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="admin-card">
        <h3>Las zonas con más movimiento</h3>
        <ul className="admin-lista">
          {zonas.slice(0, 15).map((c) => (
            <li key={`z${c.lat},${c.lon}`}>
              <a href={mapa(c)} target="_blank" rel="noreferrer">
                {c.lat.toFixed(4)}, {c.lon.toFixed(4)}
              </a>
              <span className="admin-sub">
                {c.profesionales} pro · {c.pedidos} pedido{c.pedidos === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
