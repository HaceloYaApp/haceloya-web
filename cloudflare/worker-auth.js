// ---------------------------------------------------------------------------
// EL MANEJADOR DE LOGIN, SERVIDO DESDE NUESTRO PROPIO DOMINIO.
//
// Problema que resuelve (16/09/2026):
//
//   "Unable to process request due to missing initial state. This may happen
//    if browser sessionStorage is inaccessible or accidentally cleared."
//
// Entrar con Google o con Apple abre una ventana de
// `haceloyaapp-88e3d.firebaseapp.com/__/auth/handler`, que guarda el estado
// del login en el sessionStorage DE ESE dominio y después se lo devuelve a la
// página que lo abrió. Para el navegador eso es almacenamiento de terceros, y
// los navegadores lo están cerrando: Safari hace años, Firefox con la
// protección total de cookies, y Chrome con el particionado de almacenamiento.
// Cuando lo cierran, el handler no encuentra el estado que él mismo guardó y
// tira ese error. No es un bug de la app ni una configuración mal puesta: es
// que el login viaja entre dos dominios distintos.
//
// La solución que recomienda Firebase es no cruzar dominios: servir el
// manejador desde el MISMO dominio que la web. Como haceloya.com está detrás
// de Cloudflare y el sitio en sí lo sirve GitHub Pages —que no sabe hacer de
// proxy— ese puente lo hace este worker: todo lo que empiece con `/__/` se
// pide por atrás a Firebase y se devuelve como si siempre hubiera estado acá.
//
// Con esto, `authDomain` en agenda-app/src/firebase.ts pasa a ser
// 'haceloya.com' y el login queda en un solo origen: nada que particionar.
//
// CÓMO SE PUBLICA
//   1. Cloudflare → Workers y páginas → Crear worker → pegar este archivo.
//   2. Ese worker → Configuración → Dominios y rutas → agregar una RUTA:
//        haceloya.com/__/*        (zona: haceloya.com)
//      Y otra igual para www.haceloya.com/__/* si se usa ese dominio.
//   3. Recién DESPUÉS publicar la web con el `authDomain` nuevo. Al revés, el
//      login por Google y Apple queda roto hasta que el worker exista (el de
//      mail y contraseña no usa el manejador, así que sigue andando).
//
// Cómo se comprueba que quedó bien: https://haceloya.com/__/auth/handler
// tiene que devolver 200 (hoy devuelve 404).
// ---------------------------------------------------------------------------

/** El dominio que Firebase le da al proyecto. No cambia. */
const FIREBASE = 'haceloyaapp-88e3d.firebaseapp.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Sólo el manejador de login. Cualquier otra cosa sigue su camino normal
    // hacia GitHub Pages: este worker no puede quedar en el medio del sitio.
    if (!url.pathname.startsWith('/__/')) return fetch(request);

    const destino = new URL(url.pathname + url.search, `https://${FIREBASE}`);

    // `redirect: 'manual'` a propósito: el manejador contesta con redirecciones
    // que el navegador tiene que seguir por su cuenta para que el login avance.
    // Si las siguiera el worker, el navegador nunca las vería.
    const respuesta = await fetch(new Request(destino, request), { redirect: 'manual' });

    // Se copian los encabezados para poder tocarlos: los de una respuesta
    // devuelta por fetch vienen inmutables.
    const headers = new Headers(respuesta.headers);
    // Esta página no se cachea nunca: lleva el estado de un login puntual, y
    // servirle a alguien el estado de otro sería entregarle su sesión.
    headers.set('cache-control', 'no-store');

    return new Response(respuesta.body, {
      status: respuesta.status,
      statusText: respuesta.statusText,
      headers,
    });
  },
};
