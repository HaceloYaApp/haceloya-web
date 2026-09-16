// Sirve /__/auth/* de Firebase desde haceloya.com, para que el login con
// Google y Apple no dependa del almacenamiento de terceros.
// El porqué y cómo se publica: ver README.md en esta misma carpeta.
const FIREBASE = 'haceloyaapp-88e3d.firebaseapp.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__/')) return fetch(request);

    const destino = new URL(url.pathname + url.search, `https://${FIREBASE}`);
    const res = await fetch(new Request(destino, request), { redirect: 'manual' });

    const headers = new Headers(res.headers);
    headers.set('cache-control', 'no-store');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};
