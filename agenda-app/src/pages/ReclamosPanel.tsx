import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query, limit as fsLimit } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// LOS RECLAMOS, QUE NO SE PODÍAN LISTAR EN NINGÚN LADO.
//
// Un reclamo se resolvía sólo desde adentro de la conversación: alguien lo
// abría, aparecía la barra de moderación en ese chat, y ahí se pausaba o se
// fallaba. El problema era llegar: ninguna pantalla los listaba, así que había
// que saber de antemano en qué conversación estaba el caso.
//
// Importa desde el 19/08/2026, cuando los reclamos del marketplace pasaron a
// caer acá: quien toca "Reclamar" por un producto abre un caso que, sin esta
// lista, se quedaba esperando a que alguien adivinara dónde estaba.
//
// EL LÍMITE DE ACCESO ES EL MISMO QUE EN LA APP, y no lo pone esta pantalla: lo
// ponen las reglas de Firestore. El moderador puede leer la conversación
// MIENTRAS el reclamo está abierto, y pierde el acceso al resolverlo. Es la
// regla que las dos partes ven anunciada cuando se abre el caso, así que la web
// no abre ninguna puerta nueva.

type Reclamo = {
  id: string;
  seccion: string;
  motivo: string;
  estado: string;
  refPath: string | null;
  conversationPath: string | null;
  abiertoPor: string | null;
  partes: string[];
  nombres: Record<string, string>;
  resolucion: string | null;
  createdAtMillis: number | null;
  diasEsperando: number | null;
  chatPausado: boolean;
};

type Mensaje = { id: string; senderUid: string; text: string; createdAtMillis: number | null };

const fecha = (ms: number | null) => (ms ? new Date(ms).toLocaleString('es-AR') : '—');

const SECCION_LEGIBLE: Record<string, string> = {
  servicio: 'Servicio',
  marketplace: 'Marketplace',
  curso: 'Curso u oficio',
  oficio: 'Curso u oficio',
  oferta_laboral: 'Oferta laboral',
};

export default function ReclamosPanel() {
  const [estado, setEstado] = useState<'abierto' | 'resuelto'>('abierto');
  const [items, setItems] = useState<Reclamo[] | null>(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<Reclamo | null>(null);
  // Reabrir uno cerrado (09/09/2026). El motivo es obligatorio: las dos partes
  // lo van a leer, y un caso que se abre dos veces tiene que poder explicarse.
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [reabriendo, setReabriendo] = useState<string | null>(null);

  const reabrir = async (r: Reclamo) => {
    const motivo = (motivos[r.id] || '').trim();
    if (!motivo) { setError('Escribí por qué se reabre: las dos partes lo van a leer.'); return; }
    if (!window.confirm('Vuelve a quedar sin resolver y el chat se reabre para los dos. ¿Seguro?')) return;
    setReabriendo(r.id);
    setError('');
    try {
      await httpsCallable(functions, 'reabrirReclamo')({ reclamoId: r.id, motivo });
      setMotivos((m) => ({ ...m, [r.id]: '' }));
      await cargar(estado);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo reabrir.'));
    } finally {
      setReabriendo(null);
    }
  };

  const cargar = useCallback(async (cual: string) => {
    setItems(null);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'listarReclamos')({ estado: cual });
      setItems(r?.data?.items || []);
    } catch (e) {
      setError(mensajeDeError(e, 'No pudimos cargar los reclamos.'));
      setItems([]);
    }
  }, []);

  useEffect(() => { cargar(estado); }, [estado, cargar]);

  if (abierto) {
    return (
      <UnReclamo
        reclamo={abierto}
        onVolver={() => { setAbierto(null); cargar(estado); }}
      />
    );
  }

  return (
    <section className="admin-card">
      <div className="ledger-filtros">
        {([['abierto', 'Sin resolver'], ['resuelto', 'Resueltos']] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={`ledger-chip${k === estado ? ' ledger-chip-activo' : ''}`}
            onClick={() => setEstado(k)}
          >
            {l}
          </button>
        ))}
      </div>

      {!!error && <p className="admin-error-inline">{error}</p>}
      {items === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : items.length === 0 ? (
        <p className="admin-sub">
          {estado === 'abierto' ? 'No hay reclamos esperando.' : 'Todavía no se resolvió ninguno.'}
        </p>
      ) : (
        items.map((r) => (
          <div key={r.id} className="admin-caso">
            <div className="admin-numero-fila">
              <strong>{SECCION_LEGIBLE[r.seccion] || r.seccion || 'Reclamo'}</strong>
              {/* Hace cuánto espera: es lo que hace visible que algo se está
                  quedando sin atender. Los abiertos vienen del backend con el
                  MÁS VIEJO PRIMERO, por el mismo motivo. */}
              {r.estado === 'abierto' && typeof r.diasEsperando === 'number' && (
                <span className={r.diasEsperando >= 3 ? 'admin-error-inline' : 'admin-sub'}>
                  {r.diasEsperando === 0 ? 'hoy' : `hace ${r.diasEsperando} ${r.diasEsperando === 1 ? 'día' : 'días'}`}
                </span>
              )}
            </div>
            <span className="admin-sub">
              {r.partes.map((uid) => r.nombres[uid] || uid).join('  ·  ')}
            </span>
            {!!r.motivo && <p className="admin-detalle">“{r.motivo}”</p>}
            {r.chatPausado && <span className="admin-error-inline">El chat está pausado</span>}
            {!!r.resolucion && <span className="admin-sub">Resuelto: {r.resolucion.replace(/_/g, ' ')}</span>}
            <div className="admin-acciones">
              <button type="button" className="btn" onClick={() => setAbierto(r)}>
                {r.estado === 'abierto' ? 'Abrir y resolver' : 'Ver'}
              </button>
            </div>

            {/* REABRIR UNO CERRADO. Aparece una foto que no estaba, o habla
                recién ahora la parte que había callado. Antes la única salida
                era dejarlo así: el sistema no deja abrir un segundo caso sobre
                la misma operación, para que no haya dos fallos que se
                contradigan. Sólo un moderador, por pedido explícito. */}
            {r.estado !== 'abierto' && (
              <>
                <label className="admin-label" htmlFor={`reabrir-${r.id}`}>
                  Por qué se reabre (lo leen las dos partes)
                </label>
                <input
                  id={`reabrir-${r.id}`}
                  className="admin-input"
                  value={motivos[r.id] || ''}
                  onChange={(e) => setMotivos((m) => ({ ...m, [r.id]: e.target.value }))}
                />
                <div className="admin-acciones">
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={reabriendo === r.id}
                    onClick={() => reabrir(r)}
                  >
                    {reabriendo === r.id ? 'Reabriendo...' : 'Reabrir el reclamo'}
                  </button>
                </div>
              </>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function UnReclamo({ reclamo, onVolver }: { reclamo: Reclamo; onVolver: () => void }) {
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null);
  const [errorChat, setErrorChat] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [pausado, setPausado] = useState(reclamo.chatPausado);
  const [nota, setNota] = useState('');
  // La estrella roja: a quién y por qué. Ver el bloque de abajo.
  const [calificando, setCalificando] = useState<string | null>(null);
  const [motivoStrike, setMotivoStrike] = useState('');
  const [avisoStrike, setAvisoStrike] = useState('');
  // CERRAR UN CASO ES CONTESTAR DOS COSAS (09/09/2026): a favor de quién, y a
  // quién le corresponde la estrella —o que no le corresponde a nadie, que
  // también es una respuesta—. Antes eran dos botones sueltos y la estrella
  // quedaba para "después", que en la práctica quería decir nunca.
  const [aFavorDe, setAFavorDe] = useState<string | null>(null);
  const [estrellaPara, setEstrellaPara] = useState<string | null>(null);
  const [dias, setDias] = useState<number | null>(null);

  // La conversación, leída directo de Firestore. Las reglas dejan al moderador
  // entrar SÓLO mientras el reclamo está abierto: si ya se resolvió, esto va a
  // devolver permission-denied, y eso es lo correcto — no un error a explicar.
  useEffect(() => {
    if (!reclamo.conversationPath) { setMensajes([]); return undefined; }
    const q = query(
      collection(db, `${reclamo.conversationPath}/messages`),
      orderBy('createdAt', 'asc'),
      fsLimit(200),
    );
    const unsub = onSnapshot(q, (snap) => {
      const arr: Mensaje[] = [];
      snap.forEach((d) => {
        const v = d.data() as any;
        arr.push({
          id: d.id,
          senderUid: String(v?.senderUid || ''),
          text: String(v?.text || ''),
          createdAtMillis: v?.createdAt?.toMillis?.() ?? null,
        });
      });
      setMensajes(arr);
      setErrorChat('');
    }, () => {
      setMensajes([]);
      setErrorChat(
        reclamo.estado === 'abierto'
          ? 'No pudimos leer la conversación.'
          : 'El caso ya está cerrado: el acceso a la conversación se cierra con él.',
      );
    });
    return () => unsub();
  }, [reclamo.conversationPath, reclamo.estado]);

  // Hablar en la conversación desde el panel. Ver el comentario del campo.
  const hablar = async () => {
    const texto = mensaje.trim();
    if (!texto || trabajando) return;
    setTrabajando(true);
    try {
      await httpsCallable(functions, 'hablarEnElReclamo')({ reclamoId: reclamo.id, texto });
      setMensaje('');
    } catch (e) {
      alert(`No se pudo enviar: ${(e as { message?: string })?.message || 'probá de nuevo'}`);
    } finally {
      setTrabajando(false);
    }
  };

  const pausar = async () => {
    if (trabajando) return;
    setTrabajando(true);
    setError('');
    try {
      const r: any = await httpsCallable(functions, 'bloquearChatDelReclamo')({
        reclamoId: reclamo.id,
        bloquear: !pausado,
      });
      setPausado(r?.data?.bloqueado === true);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo.'));
    } finally {
      setTrabajando(false);
    }
  };

  // ---------------------------------------------------------------------------
  // LA ESTRELLA ROJA, QUE ACÁ NO ESTABA (08/09/2026).
  //
  // La web sabía resolver y nada más. Resolver cierra el caso y avisa a las
  // partes; la sanción —una reseña de una estrella que cuenta como strike, y a
  // la tercera pasa la cuenta a revisión— es OTRA decisión, con su propio
  // botón, y desde la compu no existía. Quien moderaba desde acá cerraba el
  // caso creyendo que la sanción salía sola.
  //
  // Está disponible con el caso abierto Y con el caso cerrado: se cierra a
  // favor de uno y después se decide si al otro le corresponde la estrella.
  // ---------------------------------------------------------------------------
  const calificar = async () => {
    const motivo = motivoStrike.trim();
    if (!calificando || !motivo || trabajando) return;
    setTrabajando(true);
    setError('');
    setAvisoStrike('');
    try {
      const r: any = await httpsCallable(functions, 'calificarComoAdmin')({
        uid: calificando,
        motivo,
        reclamoId: reclamo.id,
      });
      setCalificando(null);
      setMotivoStrike('');
      setAvisoStrike(r?.data?.bloquea
        ? 'Es la tercera: la cuenta quedó bloqueada y pasó a revisión.'
        : `Listo. Quedó con ${r?.data?.strikes || 1} de 3. A la tercera se bloquea.`);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo calificar.'));
    } finally {
      setTrabajando(false);
    }
  };

  const nombreDe = (uid: string) => reclamo.nombres[uid] || uid;
  /** Cuál de las dos resoluciones corresponde al uid elegido. */
  const resolucionDe = (uid: string) => (
    uid === reclamo.partes[0] ? 'a_favor_de_quien_ofrece' : 'a_favor_de_quien_busca'
  );

  const cerrarElCaso = async () => {
    if (trabajando || !aFavorDe || !estrellaPara) return;
    const etiqueta = aFavorDe === 'desestimado'
      ? 'Se cierra sin responsables.'
      : `A favor de ${nombreDe(aFavorDe)}.`;
    const conEstrella = estrellaPara === 'ninguna'
      ? 'Sin estrella roja.'
      : `Estrella roja para ${nombreDe(estrellaPara)}.`;
    if (!window.confirm(
      `${etiqueta} ${conEstrella}\n\nEl fallo se publica dentro de la conversación y perdés el acceso a leerla. ¿Seguro?`,
    )) return;
    setTrabajando(true);
    setError('');
    try {
      await httpsCallable(functions, 'resolverReclamo')({
        reclamoId: reclamo.id,
        resolucion: aFavorDe === 'desestimado' ? 'desestimado' : resolucionDe(aFavorDe),
        estrellaPara,
        nota: nota.trim(),
      });
      onVolver();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo resolver.'));
    } finally {
      setTrabajando(false);
    }
  };

  // EL PLAZO ACORDADO. No todos los reclamos se pueden cerrar el día que se
  // leen: "devolvé la plata y lo cerramos". El caso queda ABIERTO con fecha, y
  // las dos partes la ven adentro del chat con un botón para avisar si se
  // resuelve antes.
  const acordarPlazo = async () => {
    if (trabajando || !dias || !nota.trim()) return;
    setTrabajando(true);
    setError('');
    try {
      await httpsCallable(functions, 'acordarPlazoDeReclamo')({
        reclamoId: reclamo.id, dias, nota: nota.trim(),
      });
      onVolver();
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudo acordar el plazo.'));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <section className="admin-card">
      <div className="admin-acciones">
        <button type="button" className="btn btn-outline" onClick={onVolver}>← Volver a la lista</button>
      </div>

      <h2>{SECCION_LEGIBLE[reclamo.seccion] || reclamo.seccion || 'Reclamo'}</h2>
      <span className="admin-sub">
        {reclamo.partes.map((uid) => reclamo.nombres[uid] || uid).join('  ·  ')} · abierto {fecha(reclamo.createdAtMillis)}
      </span>
      {!!reclamo.motivo && <p className="admin-detalle">“{reclamo.motivo}”</p>}

      <h2 style={{ marginTop: 18 }}>La conversación</h2>
      {mensajes === null ? (
        <p className="admin-loading">Cargando...</p>
      ) : errorChat ? (
        <p className="admin-warn">{errorChat}</p>
      ) : mensajes.length === 0 ? (
        <p className="admin-sub">No hay mensajes en esta conversación.</p>
      ) : (
        <div className="reclamo-chat">
          {mensajes.map((m) => (
            <div key={m.id} className="reclamo-msg">
              <span className="admin-sub">
                {m.senderUid === 'sistema' ? 'Sistema' : (reclamo.nombres[m.senderUid] || m.senderUid)} · {fecha(m.createdAtMillis)}
              </span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
      )}

      {reclamo.estado === 'abierto' && (
        <>
          {/* HABLAR EN LA CONVERSACIÓN (09/09/2026).
              Acá sólo se leía: para preguntar algo había que salir del panel, y
              desde la web eso ni siquiera existía. Casi todo caso se destraba
              con UNA pregunta, y sin poder hacerla el moderador falla a ciegas
              o se va a WhatsApp — que es lo que el reclamo vino a evitar.
              Mismo callable que usa la app: la web tiene que poder hacer lo
              mismo que el panel del celular. */}
          <div className="reclamo-escribir">
            <textarea
              className="admin-input"
              rows={2}
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Escribile a las dos partes..."
              aria-label="Escribir en la conversación del reclamo"
            />
            <button
              type="button"
              className="btn"
              disabled={trabajando || !mensaje.trim()}
              onClick={hablar}
            >
              Enviar mensaje
            </button>
          </div>

          <div className="admin-acciones">
            <button type="button" className="btn btn-outline" disabled={trabajando} onClick={pausar}>
              {pausado ? 'Reabrir el chat' : 'Pausar el chat mientras reviso'}
            </button>
          </div>

          {/* PRIMERO: A FAVOR DE QUIÉN. Es una elección, no un botón que
              cierra: el caso se cierra abajo, con las dos respuestas puestas. */}
          <h2 style={{ marginTop: 18 }}>1. ¿A favor de quién se resuelve?</h2>
          <div className="admin-acciones">
            {reclamo.partes.map((uid) => (
              <button
                key={uid}
                type="button"
                className={`btn${aFavorDe === uid ? '' : ' btn-outline'}`}
                onClick={() => setAFavorDe(uid)}
              >
                {nombreDe(uid)}
              </button>
            ))}
            <button
              type="button"
              className={`btn${aFavorDe === 'desestimado' ? '' : ' btn-outline'}`}
              onClick={() => setAFavorDe('desestimado')}
            >
              Se resolvió entre las partes
            </button>
          </div>

          {/* SEGUNDO: LA ESTRELLA. "Sin estrella" es una respuesta y hay que
              darla: no contestar no puede significar lo mismo que decidir que
              no le corresponde a nadie. */}
          <h2 style={{ marginTop: 12 }}>2. ¿A quién le corresponde la estrella roja?</h2>
          <p className="admin-sub">Van 3 para que la cuenta pase a revisión.</p>
          <div className="admin-acciones">
            {reclamo.partes.map((uid) => (
              <button
                key={uid}
                type="button"
                className={`btn btn-rojo${estrellaPara === uid ? '' : ' btn-outline'}`}
                onClick={() => setEstrellaPara(uid)}
              >
                ★ Estrella roja a {nombreDe(uid)}
              </button>
            ))}
            <button
              type="button"
              className={`btn${estrellaPara === 'ninguna' ? '' : ' btn-outline'}`}
              onClick={() => setEstrellaPara('ninguna')}
            >
              Sin estrella
            </button>
          </div>

          <label className="admin-label" htmlFor="reclamo-nota">
            {estrellaPara && estrellaPara !== 'ninguna'
              ? 'Por qué le corresponde (lo lee esa persona)'
              : 'Nota para las dos partes (opcional)'}
          </label>
          <input
            id="reclamo-nota"
            className="admin-input"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Se publica junto con el fallo, dentro de la conversación."
          />

          <div className="admin-acciones">
            {/* El porqué no es opcional si hay estrella: la regla tiene que
                estar donde se toma la decisión, no en el rebote del servidor. */}
            <button
              type="button"
              className="btn"
              disabled={
                trabajando || !aFavorDe || !estrellaPara
                || (estrellaPara !== 'ninguna' && !nota.trim())
              }
              onClick={cerrarElCaso}
            >
              {estrellaPara && estrellaPara !== 'ninguna' && !nota.trim()
                ? 'Escribí por qué le corresponde la estrella'
                : (!aFavorDe || !estrellaPara ? 'Contestá las dos para cerrar' : 'Cerrar el caso')}
            </button>
          </div>
          <p className="admin-sub">
            Al resolver, el fallo se publica dentro de la conversación y el acceso del moderador se
            cierra con el caso. Es la otra mitad de lo que se les prometió a las partes.
          </p>

          {/* EL PLAZO, PARA LO QUE NO SE PUEDE CERRAR HOY. */}
          <h2 style={{ marginTop: 18 }}>O acordar un plazo y dejarlo abierto</h2>
          <p className="admin-sub">
            Para cuando el caso está resuelto en la conversación pero todavía no en los hechos —una
            devolución, un repuesto—. Las dos partes ven la fecha en el chat y pueden avisar si se
            resuelve antes.
          </p>
          <div className="admin-acciones">
            {[3, 7, 15, 30].map((d) => (
              <button
                key={d}
                type="button"
                className={`btn${dias === d ? '' : ' btn-outline'}`}
                onClick={() => setDias(d)}
              >
                {d} días
              </button>
            ))}
            <button
              type="button"
              className="btn"
              disabled={trabajando || !dias || !nota.trim()}
              onClick={acordarPlazo}
            >
              {!nota.trim() ? 'Escribí qué se acordó' : 'Acordar el plazo'}
            </button>
          </div>
        </>
      )}

      {/* LA ESTRELLA ROJA. Fuera del `estado === 'abierto'` a propósito: se
          puede calificar después de cerrar el caso, que es como se usa de
          verdad. */}
      <h2 style={{ marginTop: 18 }}>Estrella roja</h2>
      <p className="admin-sub">
        Es una reseña de una estrella en la sección del reclamo y cuenta como strike. A la tercera,
        la cuenta pasa a revisión. Es una decisión aparte de en qué quedó el caso.
      </p>
      <div className="admin-acciones">
        {reclamo.partes.map((uid) => (
          <button
            key={uid}
            type="button"
            className="btn btn-outline btn-rojo"
            disabled={trabajando}
            onClick={() => { setMotivoStrike(''); setAvisoStrike(''); setCalificando(uid); }}
          >
            ★ {reclamo.nombres[uid] || uid}
          </button>
        ))}
      </div>

      {!!calificando && (
        <>
          <label className="admin-label" htmlFor="reclamo-strike">
            Por qué se califica así a {reclamo.nombres[calificando] || calificando}
          </label>
          <input
            id="reclamo-strike"
            className="admin-input"
            value={motivoStrike}
            onChange={(e) => setMotivoStrike(e.target.value)}
            placeholder="Lo lee esa persona en la notificación y queda como comentario de la reseña."
          />
          <div className="admin-acciones">
            <button
              type="button"
              className="btn btn-rojo"
              disabled={trabajando || !motivoStrike.trim()}
              onClick={calificar}
            >
              {trabajando ? 'Poniendo...' : 'Poner la estrella'}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setCalificando(null)}>
              Cancelar
            </button>
          </div>
        </>
      )}
      {!!avisoStrike && <p className="admin-ok">{avisoStrike}</p>}

      {!!error && <p className="admin-error-inline">{error}</p>}
    </section>
  );
}
