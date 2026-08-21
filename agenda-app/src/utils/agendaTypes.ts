export type JobEntry = {
  id: string;
  title: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  category: 'servicio' | 'actividad' | 'turno';
  mode?: string;
  dayOfWeek?: string;
  otherUserName?: string;
  estimatedTime?: string;
  totalCost?: number;
  serviceFee?: number;
  warrantyCost?: number;
  grandTotal?: number;
  status?: string;
  viewerRole: 'particular' | 'profesional';
};

export type ChecklistItem = { id: string; text: string; checked: boolean };
export type AgendaCategory = 'personal' | 'compras' | 'trabajo' | 'salud' | 'otro';

export type CustomEntry = {
  id: string;
  title: string;
  notes: string;
  date: string;
  allDay: boolean;
  timeFrom: string;
  timeTo: string;
  category: AgendaCategory;
  checklist: ChecklistItem[];
  photos: string[];
  // Nota rápida: es el texto, sin título ni lista. Desde el 20/08/2026 SÍ tiene
  // horario, categoría, fotos y alarmas — lo que no tiene es título.
  // undefined/false en entradas viejas = evento de siempre.
  isNote?: boolean;

  // LO QUE ESCRIBE LA APP Y LA WEB SÓLO MUESTRA (21/08/2026).
  //
  // La alarma se programa en el teléfono: la web no puede crearla ni cambiarla,
  // porque las notificaciones locales viven en el dispositivo. Pero sí tiene que
  // MOSTRARLA — antes un recordatorio se veía acá como un evento cualquiera y
  // una nota con hora se veía sin hora, y eso hace dudar de si el dato se
  // guardó.
  //
  // Estos campos NO se escriben nunca desde acá: el guardado usa `updateDoc`
  // con los campos que la web maneja, así que lo de la app queda intacto. Ver
  // `handleSaveEntry`.
  /** Recordatorio importante: título, fecha, hora y una alarma que insiste. */
  isReminder?: boolean;
  /** Cuántas veces avisa antes de la hora. */
  alarmCount?: number;
  /** Si tiene aviso configurado (para un evento o una nota). */
  reminderEnabled?: boolean;
};

export const CATEGORY_META: Record<AgendaCategory, { label: string; color: string }> = {
  personal: { label: 'Personal', color: '#2F80ED' },
  compras: { label: 'Compras', color: '#F2C94C' },
  trabajo: { label: 'Trabajo', color: '#27AE60' },
  salud: { label: 'Salud', color: '#9B59B6' },
  otro: { label: 'Otro', color: '#666666' },
};
export const CATEGORY_ORDER: AgendaCategory[] = ['personal', 'compras', 'trabajo', 'salud', 'otro'];

export type DisplayItem =
  | { kind: 'job'; date: string; sortTime: string; job: JobEntry }
  | { kind: 'custom'; date: string; sortTime: string; entry: CustomEntry };

export function newChecklistId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
