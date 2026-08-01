// Misma lista que LEDGER_ADMIN_EMAILS en el repo de la app (mobile:
// src/screens/AdminLedgerScreen.tsx / functions/src/payments.ts). Son
// codebases separadas, así que hay que mantener las dos listas iguales a
// mano — para sumar una cuenta nueva, agregarla en los 3 lugares (acá, la
// pantalla mobile, y assertLedgerAdmin en functions/src/payments.ts). La
// seguridad real vive en el backend (assertLedgerAdmin); esto sólo evita
// mostrar el botón a quien no corresponde.
export const LEDGER_ADMIN_EMAILS = ['haceloyapagos@gmail.com', 'haceloyaapp@gmail.com', 'bissicletta@icloud.com'];
