import { useState } from 'react';
import { toLocalISODate } from '../utils/dateUtils';
import './MonthCalendar.css';

interface DayMark { dots: string[]; hasProJob: boolean; hayChoque?: boolean }

interface Props {
  markedDates: Record<string, DayMark>;
  selectedDate: string | null;
  onSelectDate: (d: string) => void;
}

const WEEKDAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export default function MonthCalendar({ markedDates, selectedDate, onSelectDate }: Props) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = toLocalISODate(new Date());

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="cal">
      <div className="cal-header">
        <button type="button" onClick={() => setCursor(new Date(year, month - 1, 1))} aria-label="Mes anterior">‹</button>
        <span className="cal-title">{MONTH_NAMES[month]} {year}</span>
        <button type="button" onClick={() => setCursor(new Date(year, month + 1, 1))} aria-label="Mes siguiente">›</button>
      </div>
      <div className="cal-grid cal-weekdays">
        {WEEKDAY_LABELS.map((w, i) => <div key={i} className="cal-weekday">{w}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d == null) return <div key={i} className="cal-cell cal-cell-empty" />;
          const dateStr = toLocalISODate(new Date(year, month, d));
          const mark = markedDates[dateStr];
          const dots = mark?.dots || [];
          const hasProJob = !!mark?.hasProJob;
          // Un día con dos cosas al mismo horario se enmarca en naranja, para
          // que se vea sin abrirlo. Mismo criterio que la app.
          const hayChoque = !!mark?.hayChoque;
          const isSelected = selectedDate === dateStr;
          const isToday = dateStr === todayStr;
          return (
            <button
              type="button"
              key={i}
              className={`cal-cell${isSelected ? ' cal-cell-selected' : ''}${isToday ? ' cal-cell-today' : ''}${hayChoque ? ' hay-choque' : ''}`}
              aria-label={hayChoque ? `${d}, tenés cosas al mismo horario` : undefined}
              onClick={() => onSelectDate(dateStr)}
            >
              {hasProJob ? (
                <span className={`cal-day-pro${isSelected ? ' cal-day-pro-selected' : ''}`}>{d}</span>
              ) : (
                <span>{d}</span>
              )}
              {dots.length > 0 && (
                <div className="cal-dots">
                  {dots.slice(0, 4).map((c, j) => <span key={j} className="cal-dot" style={{ background: c }} />)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
