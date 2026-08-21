// ---------------------------------------------------------------------------
// DOS COSAS AL MISMO TIEMPO, EN EL MISMO DÍA.
//
// La agenda ya avisaba de choques, pero sólo entre una entrada propia y los
// TRABAJOS de la plataforma: dos entradas propias a la misma hora no decían
// nada, y una clase encima de una entrevista tampoco. Desde el 20/08/2026 se
// miran todas contra todas.
//
// Las NOTAS no cuentan como una actividad. Una nota es un papelito pegado en un
// día —"acordate de llamar al gasista"—, no algo que ocupe ese rato, así que no
// puede hacer que un día aparezca en conflicto. Pero sí avisa aparte cuando la
// nota cae adentro de un rato que ya está ocupado, que es cuando conviene
// saberlo.
//
// Vive suelto y sin nada de React a propósito: es la parte que se puede probar
// sin pintar una pantalla, y es donde estaban los casos raros (el que no tiene
// hora de fin, el que es de todo el día, el que termina justo cuando empieza
// el otro).
//
// ESTA ES UNA COPIA. El original está en la app, en
// `src/utils/choquesDeAgenda.ts` del repo Hacelo-Ya-App, y las dos tienen que
// decir lo mismo: si la web dijera que dos cosas no se pisan y el teléfono que
// sí, no habría forma de saber cuál tiene razón. El test
// `copiasSincronizadas.test.ts` de la app las compara cuando los dos
// repositorios están al lado.
// ---------------------------------------------------------------------------

/** Cuánto dura algo a lo que no le pusieron hora de fin. */
export const DURACION_SUPUESTA_MIN = 60;

export type ItemDeAgenda = {
  id: string;
  titulo: string;
  /** HH:MM, o '' si es de todo el día. */
  desde: string;
  /** HH:MM, o '' si no tiene fin declarado. */
  hasta: string;
  todoElDia: boolean;
  /** Una nota no ocupa el horario: no genera choques, sólo se avisa. */
  esNota: boolean;
};

export type Choque = {
  /** Los ids de lo que se pisa, en el orden en que empiezan. */
  ids: string[];
  titulos: string[];
  /** El rato compartido por todos, en HH:MM. */
  desde: string;
  hasta: string;
};

export type ChoquesDelDia = {
  choques: Choque[];
  /** Todo lo que participa de algún choque. Para pintarlo. */
  idsEnChoque: Set<string>;
  /** Notas que caen adentro de un rato ocupado. Avisan, no chocan. */
  notasEnHorarioOcupado: string[];
};

/** HH:MM a minutos desde medianoche. `null` si no es una hora válida. */
export function aMinutos(t: string | undefined | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Minutos desde medianoche a HH:MM. */
export function aHora(min: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * COMPLETAR LO QUE SE ESCRIBIÓ A MEDIAS.
 *
 * Escribir "12" y que quede "12" no es una hora, y guardarlo así hacía que la
 * entrada no participara de ningún cálculo de horario — se comportaba como si
 * no tuviera hora, sin decirlo. Ahora se completa al salir del campo:
 *
 *   "9"    -> 09:00      "12"   -> 12:00
 *   "930"  -> 09:30      "1230" -> 12:30
 *   "12:3" -> 12:30
 *
 * Devuelve '' si no hay nada rescatable, que es lo mismo que "sin hora".
 */
export function completarHora(texto: string): string {
  const crudo = String(texto || '').trim();
  if (crudo === '') return '';

  let hh: number;
  let mm: number;

  // TRES DÍGITOS SON AMBIGUOS, Y LOS DOS PUNTOS LO RESUELVEN.
  //
  // "930" son las nueve y media. "123" también son tres dígitos, pero salen de
  // escribir "12:3" y quieren decir las doce y media. Con los dígitos solos no
  // hay forma de distinguirlos; con el texto tal cual está en el campo, sí —
  // el campo va poniendo los dos puntos mientras se tipea.
  const conDosPuntos = /^(\d{1,2}):(\d{0,2})$/.exec(crudo);
  if (conDosPuntos) {
    hh = parseInt(conDosPuntos[1], 10);
    mm = conDosPuntos[2] === '' ? 0 : parseInt(conDosPuntos[2].padEnd(2, '0'), 10);
  } else {
    const digitos = crudo.replace(/\D/g, '').slice(0, 4);
    if (digitos.length === 0) return '';
    if (digitos.length <= 2) {
      // Sólo la hora: los minutos son cero. Es el caso del pedido.
      hh = parseInt(digitos, 10);
      mm = 0;
    } else if (digitos.length === 3) {
      hh = parseInt(digitos.slice(0, 1), 10);
      mm = parseInt(digitos.slice(1), 10);
    } else {
      hh = parseInt(digitos.slice(0, 2), 10);
      mm = parseInt(digitos.slice(2), 10);
    }
  }

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
  if (hh > 23 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** El rato que ocupa algo, en minutos. `null` si no ocupa un rato concreto. */
function rangoDe(item: ItemDeAgenda): { desde: number; hasta: number } | null {
  if (item.todoElDia) return null;
  const desde = aMinutos(item.desde);
  if (desde == null) return null;
  const fin = aMinutos(item.hasta);
  return { desde, hasta: fin != null && fin > desde ? fin : desde + DURACION_SUPUESTA_MIN };
}

/**
 * Qué se pisa con qué, en un día.
 *
 * Los choques se devuelven AGRUPADOS, no de a pares: tres cosas a las diez de
 * la mañana son un aviso que dice tres, no tres avisos que dicen dos. Se agrupa
 * por transitividad —A pisa a B, B pisa a C, van los tres juntos— y el rato que
 * se informa es el que comparten TODOS los del grupo, que es el que de verdad
 * está peleado.
 */
export function choquesDelDia(items: ItemDeAgenda[]): ChoquesDelDia {
  const actividades = items
    .filter((i) => !i.esNota)
    .map((i) => ({ item: i, rango: rangoDe(i) }))
    .filter((x): x is { item: ItemDeAgenda; rango: { desde: number; hasta: number } } => x.rango != null)
    .sort((a, b) => a.rango.desde - b.rango.desde);

  // Se recorre en orden de inicio y se va abriendo un grupo mientras lo que
  // sigue empiece antes de que termine lo que ya está adentro.
  const grupos: Array<Array<{ item: ItemDeAgenda; rango: { desde: number; hasta: number } }>> = [];
  let actual: typeof actividades = [];
  let finDelGrupo = -1;
  for (const a of actividades) {
    if (actual.length > 0 && a.rango.desde < finDelGrupo) {
      actual.push(a);
      finDelGrupo = Math.max(finDelGrupo, a.rango.hasta);
    } else {
      if (actual.length > 1) grupos.push(actual);
      actual = [a];
      finDelGrupo = a.rango.hasta;
    }
  }
  if (actual.length > 1) grupos.push(actual);

  const choques: Choque[] = grupos.map((g) => {
    // El rato compartido por todos: el más tarde de los inicios contra el más
    // temprano de los finales. Puede quedar vacío si el grupo se armó en
    // cadena (A con B, B con C, pero A y C no se tocan); ahí se informa el
    // rato que cubre el grupo entero, que es lo único cierto.
    const inicio = Math.max(...g.map((x) => x.rango.desde));
    const fin = Math.min(...g.map((x) => x.rango.hasta));
    const hayComun = fin > inicio;
    return {
      ids: g.map((x) => x.item.id),
      titulos: g.map((x) => x.item.titulo),
      desde: aHora(hayComun ? inicio : Math.min(...g.map((x) => x.rango.desde))),
      hasta: aHora(hayComun ? fin : Math.max(...g.map((x) => x.rango.hasta))),
    };
  });

  const idsEnChoque = new Set<string>();
  for (const c of choques) for (const id of c.ids) idsEnChoque.add(id);

  // Las notas: avisan si caen adentro de algo ocupado, choque o no.
  const ocupados = actividades.map((a) => a.rango);
  const notasEnHorarioOcupado = items
    .filter((i) => i.esNota)
    .filter((n) => {
      const r = rangoDe(n);
      if (!r) return false;
      return ocupados.some((o) => r.desde < o.hasta && o.desde < r.hasta);
    })
    .map((n) => n.id);

  return { choques, idsEnChoque, notasEnHorarioOcupado };
}

/** "tenés 2 cosas al mismo horario, entre 10:00 hs y 11:00 hs" */
export function leyendaDeChoque(c: Choque): string {
  const cuantas = c.ids.length;
  return `Tenés ${cuantas} cosas al mismo horario, entre ${c.desde} hs y ${c.hasta} hs.`;
}
