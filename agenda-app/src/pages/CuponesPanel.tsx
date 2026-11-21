import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './LedgerPage.css';

// CUPONES DE DESCUENTO (20/11/2026, pedido suyo).
//
// El espejo de la pestaña "Cupones" del panel del celular. Es la regla fija del
// proyecto: lo que se hace desde uno se tiene que poder hacer desde el otro.
// Y acá pesa más que en otras pantallas — un cupón se crea sentado frente a la
// computadora preparando una campaña, no con el teléfono en la mano.
//
// QUÉ DESCUENTA UN CUPÓN: sólo lo que la gente le paga a la app. La deuda de
// quien trabaja, y la comisión de quien compra o se anota. NUNCA el precio del
// producto, del servicio ni del curso — esa plata es de la otra persona.
//
// POR QUÉ ACÁ NO ESTÁ LA COPIA DE LAS REGLAS. En la app, las reglas de los
// cupones viven dos veces (src/utils/cupones.ts y functions/src/cupones.ts) y
// un test compara las dos copias caracter por caracter. Una TERCERA copia acá,
// en otro repositorio y sin ese test, se iba a despegar sola: la validación de
// este formulario la hace el backend, con la misma función que usa la app, y
// el motivo exacto se muestra tal como viene. Lo único que se chequea de este
// lado es lo que evita un viaje al servidor para nada.

type Cupon = {
  codigo: string;
  tipo: 'monto' | 'porcentaje';
  destino: 'deuda' | 'comision' | 'ambos';
  valor: number;
  topeEnPesos: number | null;
  cargoMinimo: number;
  usos: number;
  canjes: number;
  ahorrado: number;
  usosMax: number | null;
  usosPorPersona: number;
  paraUid: string | null;
  activo: boolean;
  nota: string;
  venceAt: number | null;
  creadoPorEmail: string;
};

type Uso = {
  uid: string; email: string; descuento: number; cargo: number;
  devuelto: number; dondeSePaga: string; refPath: string; createdAt: number | null;
};

const pesos = (n: number) => `$${Number(n || 0).toLocaleString('es-AR')}`;

const fecha = (ms: number | null) => (ms ?
  new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) :
  'sin vencimiento');

const DESTINOS: Record<string, string> = {
  deuda: 'Para pagar lo que se le debe a la app',
  comision: 'Para la comisión de una operación',
  ambos: 'Para la deuda y para la comisión',
};

const textoDelValor = (c: { tipo: string; valor: number; topeEnPesos: number | null }) => (
  c.tipo === 'monto' ?
    pesos(c.valor) :
    `${c.valor}%${c.topeEnPesos ? ` (hasta ${pesos(c.topeEnPesos)})` : ''}`
);

const numero = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.'));

export default function CuponesPanel() {
  const [lista, setLista] = useState<Cupon[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [usos, setUsos] = useState<{ codigo: string; items: Uso[] } | null>(null);

  const [codigo, setCodigo] = useState('');
  const [tipo, setTipo] = useState<'monto' | 'porcentaje'>('monto');
  const [destino, setDestino] = useState<'deuda' | 'comision' | 'ambos'>('ambos');
  const [valor, setValor] = useState('');
  const [tope, setTope] = useState('');
  const [dias, setDias] = useState('30');
  const [usosMax, setUsosMax] = useState('');
  const [usosPorPersona, setUsosPorPersona] = useState('1');
  const [cargoMinimo, setCargoMinimo] = useState('');
  const [para, setPara] = useState('');
  const [nota, setNota] = useState('');

  const traer = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r: any = await httpsCallable(functions, 'listarCupones')({});
      setLista((r?.data?.items || []) as Cupon[]);
    } catch (err) {
      setLista(null);
      setError(mensajeDeError(err, 'No se pudieron traer los cupones.'));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void traer(); }, [traer]);

  const crear = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    setListo(null);

    const limpio = codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (limpio.length < 4) { setError('El código va de 4 a 24 letras o números.'); return; }
    if (tipo === 'porcentaje' && !(numero(tope) > 0)) {
      setError('Un cupón de porcentaje necesita un tope en pesos: es lo máximo que puede descontar.');
      return;
    }
    if (nota.trim().length < 5) {
      setError('Escribí para qué es el cupón. Queda registrado y es lo que se mira después.');
      return;
    }

    // EL RESUMEN DE LO QUE PUEDE COSTAR, ANTES DE CREARLO. Es la única pantalla
    // donde un cero de más no se nota: "20%" y "$20.000" se escriben casi
    // igual. Lo que se muestra es el peor caso, que es el número que importa.
    const porUso = tipo === 'monto' ? numero(valor) : numero(tope);
    const cuantos = usosMax.trim() === '' ? null : numero(usosMax);
    const techo = cuantos ? porUso * cuantos : null;
    const ok = window.confirm(
      `Crear el cupón ${limpio}.\n\n`
      + `${textoDelValor({ tipo, valor: numero(valor), topeEnPesos: tope.trim() === '' ? null : numero(tope) })}`
      + ` · ${DESTINOS[destino]}\n`
      + `Vence en ${numero(dias)} días\n`
      + `${cuantos ? `${cuantos} usos en total` : 'Usos ilimitados'}\n\n`
      + (techo !== null ?
        `Como máximo esto puede costar ${pesos(techo)}.` :
        'SIN TOPE DE USOS: no hay un máximo de lo que puede costar.'),
    );
    if (!ok) return;

    setCreando(true);
    try {
      await httpsCallable(functions, 'crearCupon')({
        codigo: limpio,
        tipo,
        destino,
        valor: numero(valor),
        topeEnPesos: tope.trim() === '' ? null : numero(tope),
        dias: numero(dias),
        usosMax: cuantos,
        usosPorPersona: numero(usosPorPersona) || 1,
        cargoMinimo: cargoMinimo.trim() === '' ? 0 : numero(cargoMinimo),
        para: para.trim(),
        nota: nota.trim(),
      });
      setCodigo(''); setValor(''); setTope(''); setUsosMax('');
      setCargoMinimo(''); setPara(''); setNota('');
      setListo(`Cupón ${limpio} creado.`);
      await traer();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo crear el cupón.'));
    } finally {
      setCreando(false);
    }
  }, [codigo, tipo, destino, valor, tope, dias, usosMax, usosPorPersona, cargoMinimo, para, nota, traer]);

  const cambiarEstado = useCallback(async (c: Cupon) => {
    const ok = window.confirm(c.activo ?
      `Apagar ${c.codigo}.\n\nNadie más va a poder usarlo. Los usos que ya se hicieron quedan como están.` :
      `Volver a prender ${c.codigo}.\n\nVa a poder usarse de nuevo, con el mismo valor y el mismo vencimiento.`);
    if (!ok) return;
    setError(null);
    try {
      await httpsCallable(functions, 'anularCupon')({ codigo: c.codigo, activo: !c.activo });
      await traer();
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo cambiar el cupón.'));
    }
  }, [traer]);

  const verUsos = useCallback(async (c: Cupon) => {
    if (usos?.codigo === c.codigo) { setUsos(null); return; }
    setError(null);
    try {
      const r: any = await httpsCallable(functions, 'usosDeCupon')({ codigo: c.codigo });
      setUsos({ codigo: c.codigo, items: (r?.data?.items || []) as Uso[] });
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudieron traer los usos.'));
    }
  }, [usos]);

  return (
    <section className="admin-card">
      <h2>Cupones de descuento</h2>
      <p className="admin-sub">
        Un cupón descuenta sólo lo que la gente le paga a la app: la deuda de quien
        trabaja y la comisión de quien compra o se anota. Nunca el precio del producto,
        del servicio ni del curso.
      </p>

      <form className="ledger-filtros" onSubmit={crear} style={{ flexWrap: 'wrap', gap: 8 }}>
        <input
          type="text"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          placeholder="HACELO2026"
          aria-label="Código del cupón"
        />
        <select value={tipo} onChange={(e) => setTipo(e.target.value as 'monto' | 'porcentaje')} aria-label="Tipo de cupón">
          <option value="monto">Plata ($)</option>
          <option value="porcentaje">Porcentaje (%)</option>
        </select>
        <input
          type="text"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={tipo === 'monto' ? 'Pesos: 5000' : 'Porcentaje: 20'}
          aria-label={tipo === 'monto' ? 'Pesos del cupón' : 'Porcentaje del cupón'}
        />
        {tipo === 'porcentaje' && (
          <input
            type="text"
            value={tope}
            onChange={(e) => setTope(e.target.value)}
            placeholder="Tope en pesos (obligatorio)"
            aria-label="Tope en pesos del descuento"
          />
        )}
        <select
          value={destino}
          onChange={(e) => setDestino(e.target.value as 'deuda' | 'comision' | 'ambos')}
          aria-label="Para qué sirve el cupón"
        >
          <option value="ambos">Las dos cosas</option>
          <option value="deuda">Deuda con la app</option>
          <option value="comision">Comisión</option>
        </select>
        <input
          type="text"
          value={dias}
          onChange={(e) => setDias(e.target.value)}
          placeholder="Días que vale"
          aria-label="Días de vigencia"
        />
        <input
          type="text"
          value={usosMax}
          onChange={(e) => setUsosMax(e.target.value)}
          placeholder="Usos en total (vacío = sin tope)"
          aria-label="Usos en total"
        />
        <input
          type="text"
          value={usosPorPersona}
          onChange={(e) => setUsosPorPersona(e.target.value)}
          placeholder="Usos por persona"
          aria-label="Usos por persona"
        />
        <input
          type="text"
          value={cargoMinimo}
          onChange={(e) => setCargoMinimo(e.target.value)}
          placeholder="Cargo mínimo (vacío = cualquiera)"
          aria-label="Cargo mínimo para poder usarlo"
        />
        <input
          type="text"
          value={para}
          onChange={(e) => setPara(e.target.value)}
          placeholder="Para una sola cuenta: mail o uid (opcional)"
          aria-label="Mail o uid de la cuenta"
        />
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Para qué es: campaña de los afiches de Devoto, reclamo #123..."
          aria-label="Para qué es el cupón"
          maxLength={300}
          rows={2}
          style={{ flexBasis: '100%' }}
        />
        <button type="submit" className="btn" disabled={creando}>
          {creando ? 'Creando…' : 'Crear el cupón'}
        </button>
      </form>

      <p className="admin-sub">
        Si le ponés una cuenta, el cupón le queda canjeado y le llega un aviso: no
        tiene que escribir el código.
      </p>

      {error && <p className="admin-error-inline">{error}</p>}
      {listo && <p className="admin-sub"><strong>{listo}</strong></p>}
      {cargando && <p className="admin-sub">Cargando…</p>}

      {lista !== null && lista.length === 0 && !cargando && (
        <p className="admin-sub">Todavía no hay ningún cupón.</p>
      )}

      <ul className="admin-lista">
        {(lista || []).map((c) => (
          <li key={c.codigo} style={{ opacity: c.activo ? 1 : 0.65 }}>
            <strong>{c.codigo}</strong>
            {` · ${textoDelValor(c)} · ${DESTINOS[c.destino] || ''}`}
            <br />
            <span className="admin-sub">
              {`${c.usos} ${c.usos === 1 ? 'uso' : 'usos'}`}
              {c.usosMax ? ` de ${c.usosMax}` : ' (sin tope)'}
              {` · ${c.canjes} lo guardaron`}
              {` · descontado: ${pesos(c.ahorrado)}`}
              {` · vence el ${fecha(c.venceAt)}`}
              {c.cargoMinimo > 0 ? ` · desde ${pesos(c.cargoMinimo)}` : ''}
              {c.paraUid ? ' · sólo para una cuenta' : ''}
              {c.activo ? '' : ' · APAGADO'}
            </span>
            {c.nota && <><br /><span className="admin-sub">{c.nota}</span></>}
            <br />
            <button type="button" className="ledger-chip" onClick={() => verUsos(c)}>
              {usos?.codigo === c.codigo ? 'Ocultar usos' : 'Ver usos'}
            </button>
            {' '}
            <button type="button" className="ledger-chip" onClick={() => cambiarEstado(c)}>
              {c.activo ? 'Apagar' : 'Prender'}
            </button>

            {usos?.codigo === c.codigo && (
              <ul className="admin-lista">
                {usos.items.length === 0 ?
                  <li className="admin-sub">Todavía no lo usó nadie.</li> :
                  usos.items.map((u, i) => (
                    <li key={`${u.uid}_${i}`} className="admin-sub">
                      {`${u.email || u.uid} — ${pesos(u.descuento)} sobre ${pesos(u.cargo)}`}
                      {u.dondeSePaga === 'deuda' ? ' (deuda)' : ' (comisión)'}
                      {u.devuelto > 0 ? ` · se devolvió ${pesos(u.devuelto)}` : ''}
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
