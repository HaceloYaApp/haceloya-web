import type { JobEntry } from './agendaTypes';

// Versión simplificada de getPostTypeLabel (mobile): ahí se puede inferir la
// categoría a partir del serviceKey usando las listas de actividades/turnos;
// acá se confía directamente en `category` tal como está guardada en el post.
export function getJobTypeLabel(job: Pick<JobEntry, 'category' | 'mode'>): string {
  if (job.category === 'actividad') return 'Actividades';
  if (job.category === 'turno') return 'Turno';
  const raw = (job.mode || '').toLowerCase();
  if (/pregunta/.test(raw)) return 'Pregunta';
  if (/explic/.test(raw)) return 'Explicación';
  return 'Trabajo';
}

export function getJobEmoji(job: Pick<JobEntry, 'category' | 'mode'>): string {
  if (job.category === 'turno') return '🗓️';
  if (job.category === 'actividad') return '🧭';
  const raw = (job.mode || '').toLowerCase();
  if (raw.includes('pregunta')) return '❓';
  if (raw.includes('explic')) return '🧑🏻‍🏫';
  return '👷‍♂️';
}
