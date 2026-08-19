import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

// Mismo proyecto Firebase que la app mobile (haceloyaapp-88e3d) — comparte
// usuarios, reglas y datos. El apiKey de un web app de Firebase no es
// secreto: el acceso real se controla con firestore.rules/storage.rules.
const firebaseConfig = {
  apiKey: 'AIzaSyDpcOcD9ivZ_KojBg2NJBY475z4X447_MI',
  authDomain: 'haceloyaapp-88e3d.firebaseapp.com',
  projectId: 'haceloyaapp-88e3d',
  storageBucket: 'haceloyaapp-88e3d.firebasestorage.app',
  messagingSenderId: '266536498833',
  appId: '1:266536498833:web:0926b5b5df24c4d3cdb130',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// Misma región que functions/src/globalOptions.ts en el repo de la app —
// si no coincide, las llamadas a httpsCallable fallan con "not-found".
export const functions = getFunctions(app, 'southamerica-east1');

// ---------------------------------------------------------------------------
// APP CHECK, IGUAL QUE LA APP.
//
// Esta web llama Cloud Functions (la agenda y el registro contable), y esos
// callables son los MISMOS que usa la app. El backend ya mira el token de App
// Check en 54 de ellos — hoy en modo aviso, pero el día que se prenda el
// enforcement, una web sin App Check deja de funcionar entera.
//
// En la app el proveedor es Play Integrity / App Attest; en la web es
// reCAPTCHA. La clave del sitio NO es secreta (viaja en el HTML igual que el
// apiKey de arriba): lo que la hace servir es que está atada a este dominio en
// la consola de Google.
//
// LA CLAVE VA ESCRITA ACÁ, IGUAL QUE EL apiKey DE ARRIBA.
//
// No es un descuido: una clave de sitio de reCAPTCHA es pública por diseño —
// viaja en el HTML de cualquier página que la use, y tiene que hacerlo para que
// el navegador pueda ejecutar el chequeo. Lo que la hace servir no es que sea
// secreta, es que está atada a una lista de dominios en la consola de Google:
// desde cualquier otro dominio, el token sale rechazado.
//
// Y va escrita en vez de en un `.env` porque el build de este sitio se hace a
// mano en la máquina de quien publica: con la clave en un archivo ignorado por
// git, el primero que clonara el repo generaría un build sin App Check sin
// enterarse. La variable de entorno queda como forma de pisarla (por ejemplo,
// una clave distinta para probar), no como el lugar donde vive.
//
// PARA DESARROLLO LOCAL: en `localhost` reCAPTCHA no emite token válido. La
// consola del navegador imprime un token de depuración; se pega en Firebase
// Console → App Check → esta app → los tres puntos → "Administrar tokens de
// depuración". Es una vez por navegador.
// ---------------------------------------------------------------------------
const CLAVE_DE_RECAPTCHA = '6Lc6z4wtAAAAAHXIplAlp9qWrd5B785yn1K7b8D0';

const claveDeRecaptcha = (import.meta.env.VITE_RECAPTCHA_SITE_KEY || CLAVE_DE_RECAPTCHA).trim();

if (claveDeRecaptcha) {
  try {
    // En desarrollo, el SDK imprime un token de depuración en la consola del
    // navegador para dar de alta en Firebase; sin esto, en local no hay forma
    // de conseguir uno válido.
    if (import.meta.env.DEV) {
      (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(claveDeRecaptcha),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // Mismo criterio que en la app: App Check es una defensa de fondo. Que no
    // se pueda inicializar tiene que costar protección, no el sitio entero.
    console.warn('[appCheck] no se pudo inicializar', (e as Error)?.message);
  }
} else {
  console.warn('[appCheck] sin VITE_RECAPTCHA_SITE_KEY: el sitio llama a las funciones sin token de App Check.');
}

// La persistencia real (local vs. solo la pestaña) se define en el login
// según el checkbox "Mantener sesión iniciada" — ver LoginPage.tsx.
