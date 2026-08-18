import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../firebase';

// ACÁ VIVÍA LA LISTA DE ADMINISTRADORES, EN UN REPOSITORIO PÚBLICO.
//
// El archivo publicaba, en texto plano, el uid de la única persona con acceso
// al registro contable y —en un comentario— su email. Este repositorio es
// público: cualquiera que mirara el código sabía exactamente a quién apuntarle
// para llegar a los pagos de la plataforma. Un uid no es un secreto, pero el
// par "este uid, este mail, esta función" sí es un blanco.
//
// Encima había que mantener tres listas iguales a mano (esta, la de la app y
// la del backend) — y el propio archivo lo admitía. Con listas a mano lo que
// pasa siempre es que se despegan.
//
// La seguridad real siempre estuvo en el backend (`assertLedgerAdmin`): esta
// lista sólo servía para mostrar u ocultar un botón. Para eso no hace falta
// publicar quién es: alcanza con preguntar.
//
// Hallazgos H-W1-08 y H-W1-09.

/**
 * ¿Puede esta persona ver el registro contable?
 *
 * Ante cualquier problema devuelve `false`: si no se puede confirmar que
 * corresponde, el botón no se muestra. Esconderlo de más es un botón que
 * falta; mostrarlo de más es una pantalla que rebota con un error feo.
 */
export async function puedeVerElRegistro(): Promise<boolean> {
  try {
    const fns = getFunctions(app, 'southamerica-east1');
    const r = await httpsCallable(fns, 'puedeVerElRegistro')({});
    return (r.data as { puede?: boolean })?.puede === true;
  } catch {
    return false;
  }
}
