import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

// ---------------------------------------------------------------------------
// QUÉ PUEDE VER ESTA CUENTA (09/09/2026).
//
// Antes acá había una sola pregunta —`puedeVerElRegistro`, ¿ve la plata?— y con
// ella se decidía si mostrar el botón "Administración" ENTERO. Los permisos
// dejaron de ser un sí/no el 08/09/2026: hoy se tildan por separado
// (moderación, mujer a mujer, resumen, o todo), y con la pregunta vieja dar un
// acceso parcial equivalía a no dar nada — la web escondía la puerta y la app
// la abría para después decir "No tenés acceso a esta pantalla".
//
// El backend contesta sobre QUIEN LLAMA, no sobre terceros: no publica quién es
// administrador, que es el motivo por el que esto se pregunta en vez de llevar
// una lista acá (este repositorio es público, hallazgos H-W1-08 / H-W1-09).
//
// Es la misma lectura que hace la app en src/utils/permisosDeAdmin.ts. Si se
// agrega un permiso, va en los tres lados: acá, allá y en
// functions/src/adminGuard.ts, que es el que manda.
// ---------------------------------------------------------------------------

export type PermisosDeAdmin = {
  /** Ve todo y reparte accesos. */
  admin: boolean;
  moderacion: boolean;
  mujer: boolean;
  resumen: boolean;
  /** Si tiene alguno: entra al panel. */
  alguno: boolean;
};

export const SIN_PERMISOS: PermisosDeAdmin = {
  admin: false, moderacion: false, mujer: false, resumen: false, alguno: false,
};

/** Los permisos de la cuenta con sesión iniciada. Nunca tira: sin respuesta, ninguno. */
export async function misPermisosDeAdmin(): Promise<PermisosDeAdmin> {
  try {
    const r = await httpsCallable(functions, 'misPermisosDeAdmin')({});
    const d = (r.data || {}) as Partial<PermisosDeAdmin>;
    return {
      admin: d.admin === true,
      moderacion: d.moderacion === true,
      mujer: d.mujer === true,
      resumen: d.resumen === true,
      alguno: d.alguno === true,
    };
  } catch {
    return SIN_PERMISOS;
  }
}
