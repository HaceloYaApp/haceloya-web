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
