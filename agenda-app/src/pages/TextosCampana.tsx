import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';

// LOS TEXTOS DE LA CAMPAÑA DIRECTA.
//
// Los mensajes que se le mandan de a uno a profesionales y comercios de la
// zona, por WhatsApp, Instagram, Messenger y mail. Están acá para copiarlos
// desde cualquier lado, sin depender de la PC donde corre el script.
//
// DE DÓNDE SALEN. De `verTextosCampana`, que los lee de `textosCampana.ts`, que
// a su vez se GENERA desde `hacelo-piezas/scripts/rueda.py` —el script que arma
// los mensajes de verdad— con `exportar_textos.py`.
//
// Esa cadena existe por una razón concreta: hay dos paneles (éste y el de la
// app) y un script, o sea tres lugares donde podría vivir el mismo texto. Con
// copias a mano, el primer cambio los desincroniza y el panel muestra un
// mensaje distinto del que sale. Con una sola fuente, no puede pasar.
//
// LOS HUECOS SE MUESTRAN SIN RELLENAR. `{nombre}`, `{zona}`, `{rubro}`: el que
// copia de acá lo usa a mano, así que necesita ver dónde va cada dato.
//
// Es la misma pantalla que la solapa "Textos" de la app
// (src/screens/panel/TextosCampana.tsx).

type Variante = { texto: string };
type Proposito = { proposito: string; nombre: string; variantes: Variante[] };
type Canal = {
  canal: string; nombre: string;
  asuntos: string[];
  refWeb: string; refApp: string;
  linkWeb: string; linkApp: string;
  propositos: Proposito[];
};
type Datos = { canales: Canal[]; huecos: Record<string, string> };

export default function TextosCampana() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [canal, setCanal] = useState('whatsapp');
  const [verHuecos, setVerHuecos] = useState(false);
  // Qué se acaba de copiar, para avisarlo en el botón mismo. En la web no hay
  // Alert como en el teléfono, y un cartel flotante para esto es demasiado.
  const [copiado, setCopiado] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const r = await httpsCallable(functions, 'verTextosCampana')({});
      setDatos((r?.data || null) as Datos | null);
    } catch (e) {
      setError(mensajeDeError(e, 'No se pudieron leer los textos.'));
      setDatos(null);
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  const copiar = async (texto: string, cual: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(cual);
      // Se vuelve solo: si quedara fijo, el próximo clic en otro botón dejaría
      // dos "Copiado" en pantalla y ninguno sería el último.
      window.setTimeout(() => setCopiado((c) => (c === cual ? '' : c)), 1800);
    } catch {
      setError('El navegador no dejó copiar. Seleccionalo y copialo a mano.');
    }
  };

  if (cargando && !datos) return <p className="admin-sub">Cargando…</p>;

  if (!datos || !datos.canales?.length) {
    return (
      <div className="admin-card">
        {error && <p className="admin-error-inline">{error}</p>}
        <p className="admin-sub">
          No se pudieron leer los textos. Puede ser que el backend todavía no
          esté desplegado con esta parte.
        </p>
        <button type="button" className="ledger-chip" onClick={() => { void cargar(); }}>
          Volver a intentar
        </button>
      </div>
    );
  }

  const elegido = datos.canales.find((c) => c.canal === canal) || datos.canales[0];

  const boton = (texto: string, cual: string) => (
    <button
      type="button"
      className="ledger-chip"
      onClick={() => { void copiar(texto, cual); }}
    >
      {copiado === cual ? 'Copiado' : 'Copiar'}
    </button>
  );

  return (
    <div>
      <p className="admin-sub" style={{ marginBottom: 12 }}>
        Los mensajes que se mandan de a uno, por canal. Los huecos entre llaves
        los rellena el script al mandar; si copiás de acá, cambialos a mano.
      </p>

      {error && <p className="admin-error-inline">{error}</p>}

      <div className="ledger-filtros">
        {datos.canales.map((c) => (
          <button
            key={c.canal}
            type="button"
            className={`ledger-chip${c.canal === elegido.canal ? ' ledger-chip-activo' : ''}`}
            onClick={() => setCanal(c.canal)}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      {/* LOS DOS LINKS, con su ?ref= a la vista. Arriba porque son lo que más
          se copia suelto, y porque ver los dos refs juntos explica de un
          vistazo por qué son dos y no uno. */}
      <div className="admin-card">
        <h3>Los links de este canal</h3>
        <p className="admin-sub">
          El de la web lleva a la portada, para que entienda qué es antes de
          instalar nada. El de la app salta a la tienda que le corresponde al
          teléfono. Van con ref distinto para poder saber cuál de los dos usan.
        </p>
        <ul className="admin-lista">
          {([
            ['A la web', elegido.linkWeb, elegido.refWeb],
            ['A la tienda', elegido.linkApp, elegido.refApp],
          ] as const).map(([que, link, ref]) => (
            <li key={ref}>
              <strong>{que}</strong>
              <span className="admin-sub"> · {ref}</span>
              <div style={{ fontFamily: 'monospace', fontSize: '.85rem', margin: '4px 0' }}>
                {link}
              </div>
              {boton(link, `link-${ref}`)}
            </li>
          ))}
        </ul>
      </div>

      {elegido.asuntos.length > 0 && (
        <div className="admin-card">
          <h3>Los asuntos</h3>
          <p className="admin-sub">
            Tres, y el script elige uno fijo por contacto. La palabra
            «Publicidad» NO va acá: va sola en la primera línea del cuerpo, que
            es lo que pide la Disposición 4/2009.
          </p>
          <ul className="admin-lista">
            {elegido.asuntos.map((a) => (
              <li key={a}>
                <div style={{ marginBottom: 4 }}>{a}</div>
                {boton(a, `asunto-${a}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {elegido.propositos.map((p) => (
        <div className="admin-card" key={p.proposito}>
          <h3>{p.nombre}</h3>
          <p className="admin-sub">
            {p.variantes.length} {p.variantes.length === 1 ? 'variante' : 'variantes'}.
            Cada contacto recibe siempre la misma, elegida por su número de ficha.
          </p>
          <ul className="admin-lista">
            {p.variantes.map((v, i) => (
              <li key={`${p.proposito}-${i}`}>
                <span className="admin-sub">{i + 1}</span>
                <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0', lineHeight: 1.5 }}>
                  {v.texto}
                </div>
                {boton(v.texto, `${p.proposito}-${i}`)}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <button
        type="button"
        className="ledger-chip"
        onClick={() => setVerHuecos((v) => !v)}
        style={{ marginTop: 8 }}
      >
        {verHuecos ? 'Ocultar' : 'Ver'} qué significa cada hueco
      </button>
      {verHuecos && (
        <div className="admin-card" style={{ marginTop: 8 }}>
          <ul className="admin-lista">
            {Object.entries(datos.huecos).map(([hueco, que]) => (
              <li key={hueco}>
                <code>{hueco}</code>
                <span className="admin-sub"> — {que}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
