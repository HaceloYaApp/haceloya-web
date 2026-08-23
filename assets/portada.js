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

  function enchufar() {
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
