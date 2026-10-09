import { useCallback, useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import MapaDensidad, { type Datos as DatosDelMapa } from './MapaDensidad';

// QUÉ FALTA: QUÉ PROFESIONAL HAY QUE IR A BUSCAR, Y A DÓNDE.
//
// Un pedido de presupuesto vive 48 horas y después se pausa solo. El que llega
// a las 48 horas SIN NINGÚN PRESUPUESTO es lo más caro que le pasa a la app
// —la persona publicó, esperó dos días, no recibió nada y no vuelve— y a la vez
// el dato más preciso que existe sobre qué le falta: dice el oficio exacto y el
// barrio exacto donde no hay nadie.
//
// Tres cosas en una pantalla, y las tres contestan la misma pregunta:
//   · los pedidos que están por vencer, con cuántos presupuestos juntaron;
//   · dónde están, en el mismo mapa de calor que "Dónde pasa algo";
//   · el padrón completo de rubros, con cuánta gente hay anotada en cada uno.
//
// Es la misma pantalla que la solapa "Qué falta" de la app
// (src/screens/panel/QueFalta.tsx).

type Pedido = {
  id: string; titulo: string; tipo: 'oficio' | 'actividad' | 'turno'; key: string;
  rubro: string; seccion: string; restanMin: number;
  lat: number | null; lon: number | null;
  presupuestos: number | null; ofrecen: number;
  // Cuánta gente que ofrece ESE rubro vive a 1 km y a 2 km del pedido. Las dos
  // puntas están redondeadas a la grilla de 400 m, así que son aproximados.
  cerca1km: number; cerca2km: number;
};

type Rubro = {
  tipo: 'oficio' | 'actividad' | 'turno'; key: string; titulo: string; seccion: string;
  ofrecen: number; aprenden: number; abiertos: number; vencen: number; sinPresupuestos: number;
};

// Las celdas, los totales y la grilla vienen con la MISMA forma que el mapa de
// densidad, a propósito: es lo que deja usar el mismo mapa sin convertir nada.
type Datos = DatosDelMapa & {
  horas: number;
  horasDeVida: number;
  pedidos: Pedido[];
  rubros: Rubro[];
  profesionales: number;
  topeDeConteos: number;
};

const VENTANAS = [6, 12, 24, 48];

const FAMILIA: Record<Rubro['tipo'], string> = {
  oficio: 'Servicios', actividad: 'Actividades', turno: 'Turnos',
};

/** Cuánto le queda, en palabras. Negativo = ya se pasó y el cron no lo pausó aún. */
function enCuanto(min: number): string {
  if (min <= 0) return 'vencido';
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `en ${h} h ${m} min` : `en ${h} h`;
}

export default function QueFalta() {
  const [horas, setHoras] = useState(24);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');
  const [soloSinNadie, setSoloSinNadie] = useState(false);
  // La celda que se tocó en el mapa. Las coordenadas vienen redondeadas a la
  // grilla, las mismas con las que viene cada pedido, así que alcanzan como
  // identidad del cuadro.
  const [celda, setCelda] = useState<{ lat: number; lon: number } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await httpsCallable(functions, 'verQueFalta')({ horas });
      setDatos((r.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo armar la pantalla.'));
      setDatos(null);
    } finally { setCargando(false); }
  }, [horas]);

  useEffect(() => { void cargar(); }, [cargar]);

  const sinPresupuesto = (datos?.pedidos || []).filter((p) => p.presupuestos === 0);
  // Los que no tenían ninguna chance: nadie anotado en ese rubro en todo el
  // país. No es un pedido que no se contestó, es uno que no se podía contestar.
  const sinNadie = (datos?.pedidos || []).filter((p) => p.ofrecen === 0);

  // Lo que se está pidiendo en el cuadro que se tocó. Sale de los pedidos que
  // ya están cargados: la celda y el pedido traen la misma coordenada.
  const mismoLugar = (a: number, b: number) => Math.abs(a - b) < 0.00001;
  const delCuadro = celda
    ? (datos?.pedidos || []).filter((p) => (
      p.lat != null && p.lon != null
        && mismoLugar(p.lat, celda.lat) && mismoLugar(p.lon, celda.lon)
    ))
    : [];

  const rubros = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return (datos?.rubros || [])
      .filter((r) => (!soloSinNadie || r.ofrecen === 0))
      .filter((r) => !t || r.titulo.toLowerCase().includes(t) || r.seccion.toLowerCase().includes(t));
  }, [datos, filtro, soloSinNadie]);

  // Agrupado por familia y adentro por sección, con su título. Cada rubro
  // conserva su renglón y su cuenta: no se suman las secciones.
  const porFamilia = useMemo(() => {
    const salida: Array<{ familia: string; secciones: Array<{ seccion: string; items: Rubro[] }> }> = [];
    for (const tipo of ['oficio', 'actividad', 'turno'] as const) {
      const delTipo = rubros.filter((r) => r.tipo === tipo);
      if (!delTipo.length) continue;
      const porSeccion = new Map<string, Rubro[]>();
      for (const r of delTipo) {
        const l = porSeccion.get(r.seccion) || [];
        l.push(r);
        porSeccion.set(r.seccion, l);
      }
      salida.push({
        familia: FAMILIA[tipo],
        secciones: [...porSeccion.entries()].map(([seccion, items]) => ({ seccion, items })),
      });
    }
    return salida;
  }, [rubros]);

  return (
    <>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Un pedido de presupuesto dura {datos?.horasDeVida ?? 48} horas y después se pausa solo.
        Los que están por vencer dicen, con nombre y barrio, qué profesional falta: el que
        llega al final sin un solo presupuesto es el que no vuelve.
      </p>

      <div className="ledger-filtros">
        {VENTANAS.map((h) => (
          <button
            key={h}
            type="button"
            className={`ledger-chip${h === horas ? ' ledger-chip-activo' : ''}`}
            onClick={() => setHoras(h)}
          >
            {h === 48 ? 'Todos los abiertos' : `Vencen en ${h} h`}
          </button>
        ))}
        <button type="button" className="ledger-chip" onClick={() => { void cargar(); }}>
          Actualizar
        </button>
      </div>

      {error && <p className="admin-error-inline">{error}</p>}
      {cargando && !datos && <p className="admin-sub">Cargando…</p>}

      {datos && (
        <>
          <div className="admin-card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{datos.pedidos.length}</div>
                <div className="admin-sub">
                  {horas === 48 ? 'pedidos abiertos' : `vencen en menos de ${horas} h`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: '#D7263D' }}>
                  {sinPresupuesto.length}
                </div>
                <div className="admin-sub">sin un solo presupuesto</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: '#E5007E' }}>
                  {sinNadie.length}
                </div>
                <div className="admin-sub">de rubros donde no hay nadie anotado</div>
              </div>
              <div>
                <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>
                  {datos.rubros.filter((r) => r.ofrecen === 0).length}
                </div>
                <div className="admin-sub">rubros sin un profesional, de {datos.rubros.length}</div>
              </div>
            </div>
          </div>

          <div className="admin-card">
            <h3>Pedidos que están por vencer</h3>
            <p className="admin-sub">
              El que vence antes, primero. "Nadie anotado" quiere decir que en todo el país
              no hay un profesional que pueda presupuestar ese rubro — ese pedido no tenía
              ninguna chance desde el primer minuto, y es el que más urge.
            </p>
            {datos.pedidos.length === 0 ? (
              <p className="admin-sub">
                Ninguno. Todos los pedidos abiertos tienen más de {horas} h de vida por delante.
              </p>
            ) : (
              <ul className="admin-lista">
                {datos.pedidos.map((p) => (
                  <li key={p.id} style={{ display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>
                        <strong>{p.rubro}</strong>
                        <span className="admin-sub"> · {FAMILIA[p.tipo]}</span>
                      </span>
                      <span style={{ color: p.restanMin <= 0 ? '#D7263D' : undefined }}>
                        {enCuanto(p.restanMin)}
                      </span>
                    </div>
                    <div className="admin-sub" style={{ marginTop: 2 }}>
                      {p.titulo}
                    </div>
                    <div className="admin-sub" style={{ marginTop: 2 }}>
                      {p.presupuestos === null
                        ? 'presupuestos: no se contaron'
                        : `${p.presupuestos} presupuesto${p.presupuestos === 1 ? '' : 's'}`}
                      {' · '}
                      {p.ofrecen === 0
                        ? 'NADIE ANOTADO en este rubro'
                        : `${p.ofrecen} anotado${p.ofrecen === 1 ? '' : 's'} para ofrecerlo`}
                      {p.lat != null && p.lon != null && (
                        <>
                          {' · '}
                          <a
                            href={`https://www.google.com/maps?q=${p.lat},${p.lon}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ver en el mapa
                          </a>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {datos.pedidos.length > datos.topeDeConteos && (
              <p className="admin-sub">
                Los presupuestos se cuentan de los primeros {datos.topeDeConteos}: más abajo
                dice "no se contaron" en vez de inventar un cero.
              </p>
            )}
          </div>

          {/* El mismo mapa de "Dónde pasa algo", con estos datos adentro. Las
              celdas vienen en la misma consulta, así que no hay dos ventanas de
              tiempo distintas en la misma pantalla. */}
          <MapaDensidad
            datos={datos}
            cargando={cargando}
            titulo="Dónde se están venciendo"
            ayuda={`Sólo lo que está por vencer, sobre la grilla de ${datos.grillaMetros} m: `
              + 'servicios, actividades y turnos que nadie está contestando. Tocá un cuadro '
              + 'para ver QUÉ se está pidiendo ahí y cuánta gente hay para hacerlo a 1 y 2 km.'}
            capasVisibles={['pedidos', 'actividades', 'turnos']}
            alTocarCelda={setCelda}
          />

          {/* FLOTA POR ENCIMA DEL MAPA, no abajo en el scroll: el mapa dibuja
              sus controles, su leyenda y dos listas más, así que una tarjeta
              "abajo del mapa" caía dos pantallas más abajo y tocar una celda
              parecía no hacer nada. Y así también se ve con el mapa en pantalla
              completa, que es donde más se toca una celda. */}
          {celda && (
            <div className="cuadro-detalle" role="dialog" aria-label="Qué se está pidiendo en ese cuadro">
              <div className="cuadro-detalle-cabeza">
                <h3>Qué se está pidiendo en ese cuadro</h3>
                <button type="button" className="ledger-chip" onClick={() => setCelda(null)}>
                  Cerrar ✕
                </button>
              </div>
              <p className="admin-sub">
                {celda.lat.toFixed(4)}, {celda.lon.toFixed(4)} — un cuadro de{' '}
                {datos.grillaMetros} m.{' '}
                <a
                  href={`https://www.google.com/maps?q=${celda.lat},${celda.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  verlo en el mapa
                </a>
              </p>
              {delCuadro.length === 0 ? (
                <p className="admin-sub">
                  Ahí no quedó ninguna publicación por vencer con la ventana de {horas} h.
                  Probá con una ventana más grande.
                </p>
              ) : (
                <ul className="admin-lista">
                  {delCuadro.map((p) => (
                    <li key={p.id} style={{ display: 'block' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <span>
                          <strong>{p.rubro}</strong>
                          <span className="admin-sub"> · {FAMILIA[p.tipo]}</span>
                        </span>
                        <span style={{ color: p.restanMin <= 0 ? '#D7263D' : undefined }}>
                          {enCuanto(p.restanMin)}
                        </span>
                      </div>
                      <div className="admin-sub" style={{ marginTop: 2 }}>{p.titulo}</div>
                      {/* LA PREGUNTA QUE CONTESTA ESTE BLOQUE: si no hay nadie a
                          2 km, falta gente y hay que ir a buscarla; si hay diez y
                          ninguno presupuestó, lo que falta es que contesten, que
                          es otro problema con otra solución. */}
                      <div className="admin-sub" style={{ marginTop: 2 }}>
                        {p.presupuestos === null
                          ? 'presupuestos: no se contaron'
                          : `${p.presupuestos} presupuesto${p.presupuestos === 1 ? '' : 's'}`}
                        {' · lo ofrecen '}
                        <strong style={{ color: p.cerca1km === 0 ? '#E5007E' : undefined }}>
                          {p.cerca1km}
                        </strong>
                        {' a 1 km · '}
                        <strong style={{ color: p.cerca2km === 0 ? '#E5007E' : undefined }}>
                          {p.cerca2km}
                        </strong>
                        {` a 2 km · ${p.ofrecen} en todo el país`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="admin-card">
            <h3>Todos los rubros y quién hay anotado</h3>
            <p className="admin-sub">
              Los {datos.rubros.length} oficios, actividades y turnos del catálogo. "Ofrecen" es
              cuánta gente puede mandar un presupuesto de eso; "aprendiendo" es la que lo
              declaró como aprendiz, ayudante o estudiante — están anotados pero NO pueden
              presupuestar, así que un rubro con tres aprendices y cero profesionales está vacío.
            </p>
            <div className="ledger-filtros">
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Buscar un rubro o una sección…"
              />
              <button
                type="button"
                className={`ledger-chip${soloSinNadie ? ' ledger-chip-activo' : ''}`}
                onClick={() => setSoloSinNadie((v) => !v)}
              >
                Sólo los que no tienen a nadie
              </button>
            </div>
            {porFamilia.length === 0 ? (
              <p className="admin-sub">Nada que coincida con eso.</p>
            ) : porFamilia.map((f) => (
              <div key={f.familia}>
                <h4 style={{ margin: '18px 0 2px' }}>{f.familia}</h4>
                {f.secciones.map((s) => (
                  <div key={s.seccion}>
                    <div className="admin-sub" style={{
                      fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                      marginTop: 12, marginBottom: 6, fontSize: 11,
                    }}
                    >
                      {s.seccion}
                    </div>
                    <ul className="admin-lista">
                      {s.items.map((r) => (
                        <li key={`${r.tipo}:${r.key}`} style={{ opacity: r.ofrecen || r.abiertos ? 1 : 0.5 }}>
                          <span>
                            {r.titulo}
                            {r.abiertos > 0 && (
                              <span className="admin-sub">
                                {' '}· {r.abiertos} pedido{r.abiertos === 1 ? '' : 's'} abierto{r.abiertos === 1 ? '' : 's'}
                                {r.vencen > 0 ? `, ${r.vencen} por vencer` : ''}
                              </span>
                            )}
                          </span>
                          <span>
                            <strong style={{ color: r.ofrecen === 0 ? '#E5007E' : undefined }}>{r.ofrecen}</strong>
                            {r.aprenden > 0 && (
                              <span className="admin-sub"> · {r.aprenden} aprendiendo</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {datos.truncado && (
            <p className="admin-error-inline">
              Hay más pedidos o más cuentas de los que se pueden leer de una. Los números de
              esta pantalla están cortados.
            </p>
          )}
        </>
      )}
    </>
  );
}
