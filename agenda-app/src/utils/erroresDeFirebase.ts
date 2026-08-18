// LOS ERRORES DE FIREBASE, EN CASTELLANO.
//
// La pantalla hacía `setError(err?.message || 'Revisá tus datos...')`. Y
// `err.message` del SDK de Firebase es literalmente
// `"Firebase: Error (auth/invalid-credential)."` — o sea que el fallback en
// castellano NUNCA se usaba, porque `message` siempre viene poblado.
//
// Alguien que no puede entrar a su agenda leía un mensaje en inglés con un
// código entre paréntesis, que no le dice qué hacer. Hallazgo H-W1-03.
//
// Se mapea por `code`, nunca por `message`: el texto del SDK cambia entre
// versiones, el código no.

const POR_CODIGO: Record<string, string> = {
  'auth/invalid-credential': 'El email o la contraseña no coinciden. Fijate que no haya quedado un espacio de más.',
  'auth/wrong-password': 'El email o la contraseña no coinciden. Fijate que no haya quedado un espacio de más.',
  'auth/user-not-found': 'No encontramos ninguna cuenta con ese email.',
  'auth/invalid-email': 'Ese email no parece válido.',
  'auth/user-disabled': 'Esa cuenta está deshabilitada. Escribinos a haceloyaapp@gmail.com.',
  'auth/too-many-requests': 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.',
  'auth/network-request-failed': 'No pudimos conectarnos. Revisá tu conexión y probá de nuevo.',
  'auth/missing-password': 'Escribí tu contraseña.',
  'auth/popup-closed-by-user': 'Cerraste la ventana antes de terminar. Probá de nuevo.',
  'auth/popup-blocked': 'El navegador bloqueó la ventana. Habilitá las ventanas emergentes para este sitio y probá de nuevo.',
  'auth/cancelled-popup-request': '',
  'auth/account-exists-with-different-credential':
    'Ya existe una cuenta con ese email, creada con otro método. Probá con el botón que usaste la primera vez.',
  'auth/operation-not-allowed': 'Ese método de ingreso no está habilitado. Escribinos a haceloyaapp@gmail.com.',
};

/**
 * El mensaje que se le muestra a la persona.
 *
 * Devuelve cadena vacía para los "errores" que no son errores (por ejemplo
 * cancelar una ventana emergente a propósito): ahí no hay nada que avisar.
 */
export function mensajeDeError(err: unknown, porDefecto: string): string {
  const codigo = String((err as { code?: unknown } | null)?.code || '');
  if (codigo in POR_CODIGO) return POR_CODIGO[codigo];
  return porDefecto;
}
