// `new Date('2026-07-26')` se interpreta como medianoche UTC, no local — en
// Argentina (UTC-3) cae en el día anterior. Estos helpers arman/leen la
// fecha con sus componentes locales para no pasar nunca por esa conversión
// (mismo criterio que MyAgendaScreen.tsx en la app mobile).
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalISODate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function formatDate(dateStr: string): string {
  const date = parseLocalISODate(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const jobDate = new Date(date);
  jobDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((jobDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Mañana';
  if (diffDays === -1) return 'Ayer';

  return `${DAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

export function dayName(dateStr: string): string {
  return DAY_NAMES[parseLocalISODate(dateStr).getDay()];
}

export { DAY_NAMES, MONTH_NAMES };
