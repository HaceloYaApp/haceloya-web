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

  // DE DÓNDE VINO ESTA PERSONA.
  //
  // Antes de saltar a la tienda se le avisa al backend qué QR se escaneó. Eso
  // es lo que alimenta la pestaña Marketing del panel: cuánta gente entró desde
  // el afiche amarillo, cuánta desde el tótem de tal ferretería.
  //
  // Se cuenta acá y no en Cloudflare por tres razones: no está garantizado que
  // Web Analytics separe por query string —que es justo donde viaja el canal—,
  // traerlo a la app pediría guardar un token de su API, y el dato quedaría
  // afuera sin poder cruzarlo nunca con lo que pasa adentro.
  //
  // sendBeacon y no fetch: está hecho para sobrevivir a que la página se vaya,
  // que es exactamente lo que pasa 900 ms después. Con fetch, el salto a la
  // tienda puede cancelar el pedido y el escaneo no se cuenta.
  //
  // La CSP del sitio ya tiene el dominio de las funciones en `connect-src`; si
  // alguna vez se cambia de región o de proyecto, hay que tocarla también o
  // esto deja de contar SIN dar ningún error visible.
  var AVISAR = 'https://southamerica-east1-haceloyaapp-88e3d.cloudfunctions.net/registrarVisita';
  function avisar(canal){
    if (!canal) return;
    var u = AVISAR + '?ref=' + encodeURIComponent(canal);
    try {
      if (navigator.sendBeacon) { navigator.sendBeacon(u); return; }
      fetch(u, { method: 'POST', mode: 'no-cors', keepalive: true });
    } catch (e) { /* que falle la estadística nunca puede frenar el salto */ }
  }

  // EL ?ref= VIAJA A LA TIENDA, Y CADA TIENDA LO PIDE DISTINTO.
  //
  // Apple lo lee de `ct=` (campaign token) y lo muestra en App Store Connect →
  // Analytics → Adquisición. Google Play IGNORA `ct=` por completo: quiere
  // `referrer=`, y adentro una cadena de UTM, ella misma codificada.
  //
  // Hasta el 22/09 las dos ramas usaban `ct=`, así que el día que Play saliera
  // TODAS las instalaciones de Android habrían quedado sin atribuir: se sabría
  // cuánta gente tocó cada anuncio o cada afiche, pero no cuántas de ésas
  // instalaron. Y no se notaba: el link funciona igual, lleva a la ficha, la
  // persona instala. Sólo falta el dato, que es lo que no se ve.
  var ref = (params.get('ref') || '').slice(0, 40).replace(/[^a-zA-Z0-9_-]/g, '');
  function unir(url, par){
    return url + (url.indexOf('?') === -1 ? '?' : '&') + par;
  }
  function paraApple(url){
    if (!ref) return url;
    return unir(url, 'ct=' + encodeURIComponent(ref));
  }
  function paraPlay(url){
    if (!ref) return url;
    // El valor de `referrer` es una query string completa que se codifica
    // entera: `utm_source=afiche-oficio-flu` viaja como
    // `utm_source%3Dafiche-oficio-flu`. Si se manda sin codificar, Play corta
    // en el primer `&` y se pierde todo lo que venga después.
    return unir(url, 'referrer=' + encodeURIComponent('utm_source=' + ref + '&utm_medium=hacelo'));
  }

  function mostrar(id){ var el = document.getElementById(id); if (el) el.hidden = false; }

  // Se avisa SIEMPRE, en las tres ramas: quien cae en la pantalla de Android
  // sin Play todavía vivo también escaneó el papel, y ese escaneo cuenta igual
  // para saber si la pieza funciona.
  avisar(ref);

  if (isIOS) {
    var destino = paraApple(APP_STORE);
    document.getElementById('ios-link').href = destino;
    mostrar('v-ios');
    // Un respiro antes de saltar: sin él, el beacon de Cloudflare no llega a
    // disparar y la visita —o sea, el escaneo del QR— no se cuenta nunca.
    setTimeout(function(){ location.replace(destino); }, 900);
  } else if (isAndroid) {
    if (PLAY_LIVE) {
      var d = paraPlay(PLAY_URL);
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
