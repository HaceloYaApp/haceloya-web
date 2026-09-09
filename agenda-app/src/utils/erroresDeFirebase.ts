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
//
// ---------------------------------------------------------------------------
// Y LOS DE LOS CALLABLES, QUE ERAN TODOS "NO SE PUDO." (09/09/2026).
//
// Este mapa conocía SÓLO los códigos `auth/*`, o sea los del login. Cualquier
// error de una función —que es lo que hace todo el panel de administración—
// caía en el texto por defecto, y el motivo concreto que el servidor se tomó el
// trabajo de escribir se perdía en el camino.
//
// El síntoma medido: dar y quitar acceso a un administrador fallaba y la
// pantalla decía "No se pudo." y nada más. Del lado del servidor la llamada
// había llegado bien —sesión válida, App Check válido— y el callable había
// contestado exactamente por qué (que el mail no existe, que falta tildar un
// permiso, que no podés sacarte el acceso a vos mismo). Nada de eso llegaba a
// la pantalla. Sin el motivo, un rechazo correcto se ve igual que un bug, y no
// hay forma de saber cuál de los dos es.
//
// Es el mismo arreglo que la app ya tenía desde el hallazgo H-T2-12 y que nunca
// se trajo acá.
// ---------------------------------------------------------------------------

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
  // Los de las funciones. Mismos textos que la app.
  'functions/permission-denied': 'No tenés permiso para hacer esto. Puede que algo haya cambiado mientras tanto — actualizá la página y probá de nuevo.',
  'functions/unauthenticated': 'Tu sesión expiró. Volvé a entrar y probá de nuevo.',
  'functions/unavailable': 'Sin conexión con el servidor. Revisá tu internet y probá de nuevo.',
  'functions/deadline-exceeded': 'La operación tardó demasiado. Revisá tu conexión y probá de nuevo.',
  'functions/resource-exhausted': 'Demasiados intentos en poco tiempo. Esperá un momento y probá de nuevo.',
  'functions/internal': 'Tuvimos un problema de nuestro lado. Ya nos enteramos — probá de nuevo en unos minutos.',
  'functions/cancelled': 'Se canceló la operación. Probá de nuevo.',
};

/**
 * ¿Este texto lo escribimos nosotros, o lo escupió el SDK?
 *
 * Los `HttpsError` del backend llevan mensajes nuestros, en castellano y útiles
 * ("No podés sacarte el acceso a vos mismo"): esos hay que mostrarlos. El SDK,
 * en cambio, devuelve cosas como `Firebase: Error (auth/invalid-credential).` o
 * `INTERNAL`, que no le dicen nada a nadie.
 *
 * @param {string} mensaje el `message` del error.
 * @return {boolean} true si vale la pena mostrarlo tal cual.
 */
function loEscribimosNosotros(mensaje: string): boolean {
  const m = mensaje.trim();
  if (!m) return false;
  if (m.startsWith('Firebase:')) return false;
  if (/^\[[a-z-]+\/[a-z-]+\]/.test(m)) return false;
  if (m === m.toUpperCase() && !/[¿¡áéíóúñ]/i.test(m)) return false;
  return true;
}

/**
 * El mensaje que se le muestra a la persona.
 *
 * El orden es el mismo que en la app: primero el motivo del backend cuando el
 * backend explica, después el código conocido, y el genérico al final.
 *
 * Devuelve cadena vacía para los "errores" que no son errores (por ejemplo
 * cancelar una ventana emergente a propósito): ahí no hay nada que avisar.
 *
 * @param {unknown} err el error entero, no el código.
 * @param {string} porDefecto qué decir cuando no se sabe nada del error.
 * @return {string} el texto para la pantalla.
 */
export function mensajeDeError(err: unknown, porDefecto: string): string {
  const e = (err || {}) as { code?: unknown; message?: unknown };
  const codigo = String(e.code || '');
  const msg = String(e.message || '');

  // CUANDO EL BACKEND EXPLICA, GANA EL BACKEND.
  //
  // Con estos cuatro códigos el servidor tira un `HttpsError` con un motivo
  // concreto y accionable. El texto genérico es peor: dice que algo falló y no
  // dice qué. Con el resto es al revés, porque ahí el mensaje lo escribe el SDK
  // y no le sirve a nadie.
  const backendExplica = ['failed-precondition', 'already-exists', 'not-found', 'invalid-argument']
    .some((c) => codigo.includes(c));
  if (backendExplica && loEscribimosNosotros(msg)) return msg;

  if (codigo in POR_CODIGO) return POR_CODIGO[codigo];
  // El SDK de funciones prefija con `functions/`. Si llegara un código pelado,
  // se prueba también con el prefijo.
  if (`functions/${codigo}` in POR_CODIGO) return POR_CODIGO[`functions/${codigo}`];
  return porDefecto;
}
