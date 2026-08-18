import React, { useState } from 'react';
import {
  signInWithEmailAndPassword, sendPasswordResetEmail, setPersistence,
  browserLocalPersistence, browserSessionPersistence,
  GoogleAuthProvider, OAuthProvider, signInWithPopup,
} from 'firebase/auth';
import { auth } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './LoginPage.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      // Con "mantener sesión iniciada" la sesión sobrevive a cerrar el
      // navegador (browserLocalPersistence); sin marcar, se pierde al cerrar
      // la pestaña/navegador (browserSessionPersistence) — se define justo
      // antes de loguear, como recomienda la documentación de Firebase Auth.
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: unknown) {
      setError(mensajeDeError(err, 'Revisá tus datos e intentá de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  // GOOGLE Y APPLE.
  //
  // La agenda web sólo tenía email + contraseña. Una cuenta creada con Google
  // o con Apple NO TIENE CONTRASEÑA: no hay nada que escribir en ese
  // formulario, y "Olvidé mi contraseña" tampoco sirve porque no hay ninguna
  // que restablecer.
  //
  // Mientras tanto la pantalla decía "Iniciá sesión con la misma cuenta de la
  // app" — o sea que le prometía entrar a gente que no podía entrar de ninguna
  // manera, y la dejaba probando contraseñas que no existen. Hallazgo H-W1-02.
  const entrarCon = async (proveedor: 'google' | 'apple') => {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const p = proveedor === 'google'
        ? new GoogleAuthProvider()
        : new OAuthProvider('apple.com');
      if (proveedor === 'apple') {
        // Apple no manda el email si no se lo pide explícitamente.
        p.addScope('email');
        p.addScope('name');
      }
      await signInWithPopup(auth, p);
    } catch (err: unknown) {
      setError(mensajeDeError(err, 'No se pudo iniciar sesión. Probá de nuevo.'));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Ingresá tu email en el campo para enviarte un enlace de recuperación.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Te enviamos un email con instrucciones. Revisá tu bandeja.');
    } catch (err: unknown) {
      setError(mensajeDeError(err, 'No se pudo enviar el email. Intentá más tarde.'));
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Mi agenda</h1>
        <p className="login-sub">Iniciá sesión con la misma cuenta de la app.</p>

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        <label className="login-remember">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          <span>Mantener sesión iniciada</span>
        </label>

        {error && <p className="login-error">{error}</p>}
        {notice && <p className="login-notice">{notice}</p>}

        <button type="submit" disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button>
        <button type="button" className="login-link" onClick={handleReset}>Olvidé mi contraseña</button>

        <div className="login-separador"><span>o</span></div>

        <button
          type="button"
          className="login-proveedor"
          disabled={loading}
          onClick={() => entrarCon('google')}
        >
          Continuar con Google
        </button>
        <button
          type="button"
          className="login-proveedor"
          disabled={loading}
          onClick={() => entrarCon('apple')}
        >
          Continuar con Apple
        </button>
        <p className="login-ayuda">
          Si te registraste con Google o con Apple, entrá por acá: esas cuentas no tienen
          contraseña.
        </p>
      </form>
    </div>
  );
}
