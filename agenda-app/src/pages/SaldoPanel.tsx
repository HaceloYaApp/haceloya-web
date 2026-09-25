import { useCallback, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './LedgerPage.css';

// DARLE SALDO A FAVOR A UNA CUENTA (pedido suyo, 25/09/2026).
//
// El espejo de la pestaña "Saldo a favor" del panel del celular. La regla del
// proyecto es que todo lo que se hace desde uno se pueda hacer desde el otro:
// una devolución que sólo se puede tramitar con el teléfono en la mano no
// sirve cuando estás sentado frente a la computadora respondiendo reclamos.
//
// NO toca la deuda, y no es un olvido: la deuda es un cálculo que se rehace en
// cada pago y cada cierre de operación, así que bajarla a mano no duraría
// nada. Se da saldo A FAVOR y la persona lo aplica con "pagar con saldo", que
// deja un pago registrado de verdad y hace que la deuda quede en cero.

type Cuenta = {
  uid: string; nombre: string; email: string; saldo: number; deuda: number;
};

const pesos = (n: number) => `$${Number(n || 0).toLocaleString('es-AR')}`;

export default function SaldoPanel() {
  const [q, setQ] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Cuenta[] | null>(null);
  const [elegida, setElegida] = useState<Cuenta | null>(null);
  const [monto, setMonto] = useState('');
  const [nota, setNota] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [listo, setListo] = useState<string | null>(null);

  const buscar = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    const texto = q.trim();
    if (texto.length < 3) { setError('Escribí al menos 3 letras.'); return; }
    setBuscando(true); setError(null); setListo(null); setElegida(null);
    try {
      const r: any = await httpsCallable(functions, 'buscarCuentaParaSaldo')({ q: texto });
      setResultados((r?.data?.items || []) as Cuenta[]);
    } catch (err) {
      setResultados(null);
      setError(mensajeDeError(err, 'No se pudo buscar. Probá de nuevo.'));
    } finally {
      setBuscando(false);
    }
  }, [q]);

  const aplicar = useCallback(async () => {
    if (!elegida) return;
    const n = Number(String(monto).replace(/\./g, '').replace(',', '.'));
    if (!isFinite(n) || n === 0) {
      setError('Poné un número distinto de cero. Para restar, usá el signo menos.');
      return;
    }
    if (nota.trim().length < 5) {
      setError('Escribí por qué hacés el ajuste. Queda registrado y es lo que se mira después.');
      return;
    }
    // El resumen ANTES de tocar nada: el error que importa acá es el cero de
    // más, y se ve mucho mejor en "queda en $X" que en el campo que tipeaste.
    const queda = elegida.saldo + n;
    const quien = elegida.nombre || elegida.email || elegida.uid;
    const ok = window.confirm(
      `${n > 0 ? `Darle ${pesos(n)}` : `Sacarle ${pesos(Math.abs(n))}`} a ${quien}.\n\n`
      + `Saldo ahora: ${pesos(elegida.saldo)}\nQueda en: ${pesos(queda)}`,
    );
    if (!ok) return;
    setAplicando(true); setError(null);
    try {
      const r: any = await httpsCallable(functions, 'ajustarSaldoDeAdmin')({
        uid: elegida.uid, monto: n, nota: nota.trim(),
      });
      const cuenta = r?.data?.cuenta as Cuenta;
      setElegida(cuenta);
      setResultados((prev) => (prev || []).map((c) => (c.uid === cuenta.uid ? cuenta : c)));
      setMonto(''); setNota('');
      setListo(`Saldo de ${cuenta.nombre || cuenta.email}: ${pesos(cuenta.saldo)}`);
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo aplicar el ajuste. Probá de nuevo.'));
    } finally {
      setAplicando(false);
    }
  }, [elegida, monto, nota]);

  return (
    <section className="admin-card">
      <p className="admin-sub">
        Buscá por mail, por uid o por nombre de pila. El mail y el uid son exactos;
        el nombre busca por el principio.
      </p>

      <form className="ledger-filtros" onSubmit={buscar}>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="mail, uid o nombre"
          aria-label="Buscar una cuenta"
        />
        <button type="submit" className="btn" disabled={buscando}>
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {error && <p className="admin-error-inline">{error}</p>}
      {listo && <p className="admin-sub"><strong>{listo}</strong></p>}

      {resultados !== null && resultados.length === 0 && (
        <p className="admin-sub">No se encontró ninguna cuenta.</p>
      )}

      <ul className="admin-lista">
        {(resultados || []).map((c) => (
          <li key={c.uid}>
            <button
              type="button"
              className={`ledger-chip${elegida?.uid === c.uid ? ' ledger-chip-activo' : ''}`}
              aria-pressed={elegida?.uid === c.uid}
              onClick={() => setElegida(elegida?.uid === c.uid ? null : c)}
            >
              <strong>{c.nombre || '(sin nombre)'}</strong>
              {c.email ? ` · ${c.email}` : ''}
              {` · A favor: ${pesos(c.saldo)}`}
              {c.deuda > 0 ? ` · Debe: ${pesos(c.deuda)}` : ''}
            </button>
          </li>
        ))}
      </ul>

      {elegida && (
        <div className="admin-card" style={{ marginTop: 12 }}>
          <h3>Ajustar el saldo</h3>
          <p className="admin-sub">
            En positivo le das saldo; en negativo se lo sacás. Con signo menos no puede
            quedar por debajo de cero.
          </p>
          <input
            type="text"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="Ej: 4550  (o -4550)"
            aria-label="Monto del ajuste"
          />
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Por qué: se cayó la reserva X, reclamo #123..."
            aria-label="Por qué hacés el ajuste"
            maxLength={300}
            rows={3}
          />
          <button type="button" className="btn" onClick={aplicar} disabled={aplicando}>
            {aplicando ? 'Aplicando…' : 'Aplicar ajuste'}
          </button>
        </div>
      )}
    </section>
  );
}
