// uid fijo, no email — comparar por email dejaba que cualquiera se
// registrara con haceloyapagos@gmail.com o haceloyaapp@gmail.com (ninguna de
// las dos tenía cuenta creada, confirmado 2026-08) y se quedara con el
// acceso. Misma lista que LEDGER_ADMIN_UIDS en el repo de la app (mobile:
// src/screens/AdminLedgerScreen.tsx / functions/src/payments.ts). Son
// codebases separadas, así que hay que mantener las tres listas iguales a
// mano. La seguridad real vive en el backend (assertLedgerAdmin); esto sólo
// evita mostrar el botón a quien no corresponde. Sólo bissicletta@icloud.com
// tiene cuenta hoy; sumar el resto acá y en el backend cuando se registren.
export const LEDGER_ADMIN_UIDS: string[] = [
  'AdhAxVbpMXPsT3vtIG4dExFTt262', // bissicletta@icloud.com
  // 'TODO', // haceloyapagos@gmail.com — agregar el uid cuando se registre
  // 'TODO', // haceloyaapp@gmail.com — agregar el uid cuando se registre
];
