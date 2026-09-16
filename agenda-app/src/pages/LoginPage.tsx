import React, { useState } from 'react';
import {
  signInWithEmailAndPassword, setPersistence,
  browserLocalPersistence, browserSessionPersistence,
  GoogleAuthProvider, OAuthProvider, signInWithPopup,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../firebase';
import { mensajeDeError } from '../utils/erroresDeFirebase';
import './LoginPage.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // ARRANCA DESTILDADO.
  //
  // Venía tildado, así que la sesión sobrevivía al cierre del navegador salvo
  // que la persona lo destildara a propósito. En un celular propio eso es una
  // comodidad; en la computadora de un locutorio o en la de un familiar, es
  // dejar la sesión abierta.
  //
  // Y esta pantalla no da acceso sólo a la agenda: para quien administra los
  // pagos, la misma sesión abre el registro contable con los nombres, montos y
  // referencias de todas las operaciones de la plataforma. Que eso quede
  // abierto tiene que ser una decisión, no el default. Hallazgo H-W1-15.
  const [rememberMe, setRememberMe] = useState(false);
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
      // EL MISMO MAIL QUE MANDA LA APP, NO EL DE FIREBASE (16/09/2026).
      //
      // Acá estaba `sendPasswordResetEmail`, que dispara la plantilla por
      // defecto de Firebase: un mail sin marca y, sobre todo, una página de
      // cambio de contraseña genérica con UN SOLO campo — sin repetir la
      // contraseña, y sin parecerse en nada a la app.
      //
      // El callable manda el mail con la marca y con un link a nuestra propia
      // página (public/index.html del repo de la app), que pide la contraseña
      // dos veces. Es el mismo camino que usa la app: un solo mail de
      // recuperación para los dos lados.
      await httpsCallable(functions, 'sendCustomPasswordReset')({ email: email.trim() });
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
