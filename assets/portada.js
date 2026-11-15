// El JavaScript de la portada.
//
// POR QUÉ ESTÁ EN UN ARCHIVO Y NO EN LÍNEA, QUE ES COMO ESTABA:
//
// El 21/08/2026 se puso una Content-Security-Policy en Cloudflare con
// `script-src 'self'`, sin `'unsafe-inline'`. Eso mató TODO el JavaScript de
// esta página —estaba en un <script> en línea y en 7 atributos `onclick=`— y
// no se vio hasta que alguien la abrió con un navegador de verdad el 22/08.
// Con `curl` la página se veía perfecta.
//
// Lo que estuvo roto un día entero:
//   · el menú del teléfono no abría (a 360px no quedaba NINGUNA navegación)
//   · las pestañas "Busco / Ofrezco un servicio" no cambiaban de panel
//   · y lo peor: el formulario de contacto perdía su `preventDefault`, así que
//     el navegador lo mandaba por GET a la propia URL. Los datos no le
//     llegaban a nadie Y quedaban escritos en la barra de direcciones, en el
//     historial y en los registros de Cloudflare y GitHub Pages.
//
// Con el código acá, `script-src 'self'` lo permite y la política sigue
// estricta. Si algún día hace falta volver a poner algo en línea, el precio es
// habilitar `'unsafe-inline'`, que es justo lo que esta política existe para
// evitar. No lo hagas: agregá el código acá.

(function () {
  'use strict';

  function toggleMobileMenu() {
    var nav = document.getElementById('mnav');
    if (!nav) return;
    var abierto = (nav.style.display === 'none' || !nav.style.display);
    nav.style.display = abierto ? 'flex' : 'none';
    // El estado anunciado tiene que seguir al estado real: si sólo se pone en
    // el HTML, queda mintiendo desde el primer toque. Hallazgo H-W1-20.
    document.querySelectorAll('.menu-toggle').forEach(function (b) {
      b.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });
  }

  function showTab(which) {
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.how-panel').forEach(function (p) {
      p.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn[data-tab="' + which + '"]').forEach(function (b) {
      b.classList.add('active');
      b.setAttribute('aria-selected', 'true');
    });
    var panel = document.getElementById('panel-' + which);
    if (panel) panel.classList.add('active');
  }

  // DE DÓNDE VINO EL QUE ENTRÓ A LA PORTADA (15/11/2026).
  //
  // Los mensajes de la campaña directa llevan DOS links: uno acá
  // (`haceloya.com/?ref=wpp-web`) y otro al router de tiendas
  // (`/ir/?ref=wpp-app`). Hasta hoy esta página IGNORABA el `?ref=`, así que
  // del primero de los dos no quedaba ningún rastro.
  //
  // Y los dos badges estaban fijos en `?ref=web-lanzamiento`: alguien que
  // llegaba desde un mail y después bajaba la app se contaba como "vino de la
  // web". El origen se perdía justo en el paso que importa.
  //
  // El endpoint es el mismo que usa `/ir/ir.js`, así que el dominio ya está en
  // el `connect-src` de la CSP. Si alguna vez se cambia de región o de
  // proyecto hay que tocar la política también, o esto deja de contar sin dar
  // ningún error visible.
  var AVISAR = 'https://southamerica-east1-haceloyaapp-88e3d.cloudfunctions.net/registrarVisita';

  function refDeLaUrl() {
    try {
      var r = new URLSearchParams(location.search).get('ref') || '';
      // Mismo recorte y misma limpieza que en `/ir/`: 40 caracteres, y sólo
      // letras, números, guión y guión bajo.
      return r.slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
    } catch (e) { return ''; }
  }

  // Igual que en `/ir/`: tres valores y nada más. El user-agent completo dice
  // versión de sistema, de navegador y a veces modelo, y eso ya identifica.
  function sistema() {
    var ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'otro';
  }

  function medirOrigen() {
    var ref = refDeLaUrl();
    if (!ref) return;   // visita directa: los badges quedan como estaban

    // 1. Se cuenta la llegada a la portada.
    //
    // sendBeacon y no fetch por lo mismo que en `/ir/`: sobrevive a que la
    // página se vaya. Acá la persona se queda leyendo, así que es menos
    // crítico, pero el que entra y toca descargar enseguida es justo el caso
    // en que fetch se cancelaría.
    try {
      var u = AVISAR + '?ref=' + encodeURIComponent(ref) + '&so=' + sistema();
      if (navigator.sendBeacon) { navigator.sendBeacon(u); }
      else { fetch(u, { method: 'POST', mode: 'no-cors', keepalive: true }); }
    } catch (e) { /* que falle la estadística no puede romper la página */ }

    // 2. Los badges arrastran el MISMO ref, con `contado=1`.
    //
    // `contado=1` le dice a `/ir/` que no lo vuelva a anotar: esta persona ya
    // quedó registrada en el punto 1, y contarla dos veces convertiría "cuánta
    // gente entró" en un número inflado que nadie podría interpretar.
    //
    // El ref igual viaja a Apple (`ct=`) y a Play (`referrer=`), que es lo que
    // después dice cuántas INSTALACIONES trajo cada canal. Eso no se duplica:
    // lo cuenta la tienda, no nosotros.
    document.querySelectorAll('.store-badge-link').forEach(function (a) {
      a.href = '/ir/?ref=' + encodeURIComponent(ref) + '&contado=1';
    });
  }

  function enchufar() {
    medirOrigen();

    document.querySelectorAll('.menu-toggle').forEach(function (b) {
      b.addEventListener('click', toggleMobileMenu);
    });

    // El rubro sale de `data-tab`, que ya estaba en el HTML para otra cosa:
    // así el botón no necesita repetir el valor en dos lugares.
    document.querySelectorAll('.tab-btn[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.dataset.tab); });
    });

    var form = document.getElementById('contactForm');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nombre = this.nombre.value.trim();
      var email = this.email.value.trim();
      var mensaje = this.mensaje.value.trim();
      var subject = 'Consulta desde haceloya.com — ' + nombre;
      var body = 'Nombre: ' + nombre + '\nEmail: ' + email + '\n\n' + mensaje;
      var mailtoUrl = 'mailto:haceloyaapp@gmail.com'
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body);
      window.location.href = mailtoUrl;
      // El mailto no avisa si falló: no hay evento, no hay error. Lo único que
      // se puede hacer es contar qué tendría que haber pasado.
      var aviso = document.getElementById('contactAviso');
      if (aviso) aviso.hidden = false;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enchufar);
  } else {
    enchufar();
  }
})();
