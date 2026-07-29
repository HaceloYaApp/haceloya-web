export function timeToMinutes(t: string | undefined | null): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(t || ''));
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function rangesOverlap(aFrom: number, aTo: number | null, bFrom: number, bTo: number | null): boolean {
  // Si falta el "hasta" de alguno de los dos, se asume 1 hora de duración
  // (mismo criterio que el resto de la app para horarios sueltos).
  const aEnd = aTo != null && aTo > aFrom ? aTo : aFrom + 60;
  const bEnd = bTo != null && bTo > bFrom ? bTo : bFrom + 60;
  return aFrom < bEnd && bFrom < aEnd;
}

export function findConflictingJobs<T extends { timeFrom: string; timeTo: string }>(
  dayJobs: T[],
  allDay: boolean,
  timeFrom: string,
  timeTo: string
): T[] {
  if (dayJobs.length === 0) return [];
  const from = allDay ? null : timeToMinutes(timeFrom);
  if (from == null) {
    return dayJobs.filter((job) => timeToMinutes(job.timeFrom) != null);
  }
  const to = timeToMinutes(timeTo);
  return dayJobs.filter((job) => {
    const jFrom = timeToMinutes(job.timeFrom);
    if (jFrom == null) return false;
    const jTo = timeToMinutes(job.timeTo);
    return rangesOverlap(from, to, jFrom, jTo);
  });
}
