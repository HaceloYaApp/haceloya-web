// El JavaScript de /ir/, el router de canal.
//
// POR QUÉ ESTÁ ACÁ Y NO EN LÍNEA: la CSP de Cloudflare tiene `script-src 'self'`
// sin `'unsafe-inline'`. Un <script> en línea NO SE EJECUTA y la página queda
// con las tres secciones ocultas: se ve sólo el logo, como si fuera una página
// vacía. Pasó exactamente eso el 19/09/2026, y antes el 22/08 con la portada
// (ver la cabecera de assets/portada.js).
//
// Y OJO CON CÓMO SE VERIFICA: con `curl` el HTML se ve perfecto, porque el
// bloqueo lo hace el navegador al ejecutar, no el servidor al servir. Esto sólo
// se comprueba abriendo la página en un navegador de verdad.

(function(){
  var APP_STORE = 'https://apps.apple.com/ar/app/hacelo-ya/id6811084324';
  // Cuando la app salga a producción en Google Play, poné acá la ficha real y
  // descomentá PLAY_LIVE. Los QR ya impresos empiezan a mandar a Play solos:
  // el destino vive en esta página, no en el papel.
  var PLAY_URL  = 'https://play.google.com/store/apps/details?id=com.bissi.haceloapp';
  var PLAY_LIVE = false;

  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) ||
              // iPadOS 13+ se hace pasar por Mac: se lo reconoce por el táctil.
              (/Macintosh/.test(ua) && typeof document.ontouchend !== 'undefined');
  var isAndroid = /Android/.test(ua);

  var params = new URLSearchParams(location.search);
  var forced = params.get('to');           // ?to=ios|android|web para probar
  if (forced === 'ios') { isIOS = true; isAndroid = false; }
  if (forced === 'android') { isAndroid = true; isIOS = false; }
  if (forced === 'web') { isIOS = false; isAndroid = false; }

  // El ?ref= viaja a la tienda en el link de Apple (campaña de App Analytics)
  // y queda igual en la URL de esta página, que es lo que cuenta Cloudflare.
  var ref = (params.get('ref') || '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
  function conRef(url){
    if (!ref) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'ct=' + encodeURIComponent(ref);
  }

  function mostrar(id){ var el = document.getElementById(id); if (el) el.hidden = false; }

  if (isIOS) {
    var destino = conRef(APP_STORE);
    document.getElementById('ios-link').href = destino;
    mostrar('v-ios');
    // Un respiro antes de saltar: sin él, el beacon de Cloudflare no llega a
    // disparar y la visita —o sea, el escaneo del QR— no se cuenta nunca.
    setTimeout(function(){ location.replace(destino); }, 900);
  } else if (isAndroid) {
    if (PLAY_LIVE) {
      var d = conRef(PLAY_URL);
      document.getElementById('ios-link').href = d;
      mostrar('v-ios');
      setTimeout(function(){ location.replace(d); }, 900);
    } else {
      mostrar('v-android');
      var m = document.getElementById('mail-android');
      if (ref) m.href = m.href + '&body=' + encodeURIComponent('(vengo de: ' + ref + ')');
    }
  } else {
    mostrar('v-desktop');
  }
})();
