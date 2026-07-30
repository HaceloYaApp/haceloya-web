import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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

// La persistencia real (local vs. solo la pestaña) se define en el login
// según el checkbox "Mantener sesión iniciada" — ver LoginPage.tsx.
