# El manejador de login, servido desde nuestro propio dominio

## Qué problema resuelve

> Unable to process request due to missing initial state. This may happen if
> browser sessionStorage is inaccessible or accidentally cleared.

Entrar con Google o con Apple abre una ventana de
`haceloyaapp-88e3d.firebaseapp.com/__/auth/handler`, que guarda el estado del
login en el sessionStorage **de ese dominio** y después se lo devuelve a la
página que lo abrió. Para el navegador eso es almacenamiento de terceros, y los
navegadores lo están cerrando: Safari hace años, Firefox con la protección
total de cookies, Chrome con el particionado. Cuando lo cierran, el manejador
no encuentra el estado que él mismo guardó y tira ese error.

No es un bug de la app ni una configuración mal puesta: es que el login viaja
entre dos dominios distintos.

## Cómo lo resuelve

Lo que recomienda Firebase es no cruzar dominios: servir el manejador desde el
mismo dominio que la web. Como haceloya.com está detrás de Cloudflare y el
sitio lo sirve GitHub Pages —que no sabe hacer de proxy— ese puente lo hace
`worker-auth.js`: todo lo que empieza con `/__/` se pide por atrás a Firebase y
se devuelve como si siempre hubiera estado acá.

Con eso, `authDomain` en `agenda-app/src/firebase.ts` es `haceloya.com` y el
login queda en un solo origen: nada que particionar.

## Cómo se publica

1. Cloudflare → **Workers y páginas** → Crear worker (`Start with Hello
   World!`) → nombre `auth-handler` → Deploy.
2. **Edit code**: borrar todo y pegar `worker-auth.js`. Deploy.
3. Ese worker → **Settings → Domains & Routes → Add → Route**:
   - Zona: `haceloya.com`
   - Ruta: `haceloya.com/__/*`
   - Failure mode: **Fail closed**. Si el worker falla, "fail open" mandaría el
     pedido a GitHub Pages, que no tiene nada en `/__/`: un 404 confuso en vez
     de un error.
   - Repetir con `www.haceloya.com/__/*`.
4. Comprobar: `https://haceloya.com/__/auth/handler` tiene que devolver una
   página (antes del worker devuelve 404).
5. **Recién ahí** publicar la web con el `authDomain` nuevo. Al revés, Google y
   Apple quedan rotos hasta que el worker exista (mail y contraseña no usan el
   manejador, así que siguen andando).

## Lo que hay que autorizar afuera

- **Google** (Cloud Console → Credenciales → el cliente web del proyecto):
  agregar `https://haceloya.com/__/auth/handler` a las URIs de
  redireccionamiento autorizadas.
- **Apple** (Services ID): domain `haceloya.com`, return URL
  `https://haceloya.com/__/auth/handler`.

## Detalles del código

- `redirect: 'manual'` no es un detalle: el manejador contesta con
  redirecciones que **el navegador** tiene que seguir para que el login avance.
  Si las siguiera el worker, el navegador nunca las vería.
- `cache-control: no-store` porque esa página lleva el estado de un login
  puntual: servirle a alguien el estado de otro sería entregarle su sesión.
- El `if` de `/__/` es lo que evita que el worker quede en el medio del resto
  del sitio.
