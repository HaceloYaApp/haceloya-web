import React, { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase';
import './LoginPage.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      setError(err?.message || 'Revisá tus datos e intentá de nuevo.');
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
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar el email. Intentá más tarde.');
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

        {error && <p className="login-error">{error}</p>}
        {notice && <p className="login-notice">{notice}</p>}

        <button type="submit" disabled={loading}>{loading ? 'Ingresando...' : 'Ingresar'}</button>
        <button type="button" className="login-link" onClick={handleReset}>Olvidé mi contraseña</button>
      </form>
    </div>
  );
}
