import { useEffect, useState } from 'react';
import type { AgendaCategory, ChecklistItem, CustomEntry, JobEntry } from '../utils/agendaTypes';
import { CATEGORY_META, CATEGORY_ORDER, newChecklistId } from '../utils/agendaTypes';
import { findConflictingJobs } from '../utils/scheduleOverlap';
import { formatDate, parseLocalISODate, toLocalISODate } from '../utils/dateUtils';
import './EntryEditor.css';

interface Props {
  entry: CustomEntry | null; // null = nueva entrada
  initialDate: string;
  conflictJobsForDate: (date: string) => JobEntry[];
  saving: boolean;
  uploadingPhoto: boolean;
  onSave: (payload: Omit<CustomEntry, 'id'>) => void;
  onDelete: () => void;
  onAddPhotos: (files: FileList) => void;
  onRemovePhoto: (url: string) => void;
  photosDraft: string[];
  onClose: () => void;
}

export default function EntryEditor({
  entry, initialDate, conflictJobsForDate, saving, uploadingPhoto,
  onSave, onDelete, onAddPhotos, onRemovePhoto, photosDraft, onClose,
}: Props) {
  const [title, setTitle] = useState(entry?.title || '');
  const [notes, setNotes] = useState(entry?.notes || '');
  const [date, setDate] = useState(entry?.date || initialDate);
  const [allDay, setAllDay] = useState(entry?.allDay || false);
  const [timeFrom, setTimeFrom] = useState(entry?.timeFrom || '');
  const [timeTo, setTimeTo] = useState(entry?.timeTo || '');
  const [category, setCategory] = useState<AgendaCategory>(entry?.category || 'personal');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(entry?.checklist || []);
  const [newItemText, setNewItemText] = useState('');
  const [isNote, setIsNote] = useState(entry?.isNote === true);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const conflicts = findConflictingJobs(conflictJobsForDate(date), allDay, timeFrom, timeTo);

  const handleTimeInput = (setter: (v: string) => void) => (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    let out = digits;
    if (digits.length >= 3) out = `${digits.slice(0, 2)}:${digits.slice(2)}`;
    setter(out);
  };

  const addChecklistItem = () => {
    const text = newItemText.trim();
    if (!text) return;
    setChecklist((prev) => [...prev, { id: newChecklistId(), text, checked: false }]);
    setNewItemText('');
  };
  const removeChecklistItem = (id: string) => setChecklist((prev) => prev.filter((it) => it.id !== id));
  const toggleChecklistItem = (id: string) => setChecklist((prev) => prev.map((it) => (it.id === id ? { ...it, checked: !it.checked } : it)));

  const stepDate = (delta: number) => {
    const d = parseLocalISODate(date);
    d.setDate(d.getDate() + delta);
    setDate(toLocalISODate(d));
  };

  const handleSave = () => {
    const trimmed = title.trim();
    const trimmedNotes = notes.trim();
    if (isNote) {
      if (!trimmedNotes) { alert('Escribí la nota.'); return; }
      onSave({
        title: '', notes: trimmedNotes, date, allDay: true, timeFrom: '', timeTo: '',
        category, checklist: [], photos: [], isNote: true,
      });
      return;
    }
    if (!trimmed) { alert('Escribí un título para la entrada.'); return; }
    if (!allDay && timeFrom && !/^\d{2}:\d{2}$/.test(timeFrom)) { alert('Completá la hora en formato HH:MM.'); return; }
    onSave({
      title: trimmed,
      notes: trimmedNotes,
      date,
      allDay,
      timeFrom: allDay ? '' : timeFrom,
      timeTo: allDay ? '' : timeTo,
      category,
      checklist,
      photos: photosDraft,
      isNote: false,
    });
  };

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="editor-card" onClick={(e) => e.stopPropagation()}>
        <div className="hazard-stripe" />
        <div className="editor-header">
          <h2>{entry ? 'Editar entrada' : 'Nueva entrada'}</h2>
          <button type="button" className="editor-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        <div className="editor-body">
          {!entry && (
            <div className="pill-row">
              <button type="button" className={`cat-pill${!isNote ? ' cat-pill-active' : ''}`} onClick={() => setIsNote(false)}>Evento completo</button>
              <button type="button" className={`cat-pill${isNote ? ' cat-pill-active' : ''}`} onClick={() => setIsNote(true)}>Solo nota</button>
            </div>
          )}

          {!isNote && (
            <>
              <label>Título</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Comprar materiales, Turno médico..." />
            </>
          )}

          <label>{isNote ? 'Nota' : 'Notas (opcional)'}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={isNote ? 'Escribí lo que necesites anotar...' : 'Detalles adicionales...'}
            rows={isNote ? 5 : 3}
            autoFocus={isNote}
          />

          <label>Fecha</label>
          <div className="date-stepper">
            <button type="button" onClick={() => stepDate(-1)}>‹</button>
            <span>{formatDate(date)}</span>
            <button type="button" onClick={() => stepDate(1)}>›</button>
            <button type="button" className="today-btn" onClick={() => setDate(toLocalISODate(new Date()))}>Hoy</button>
          </div>

          {!isNote && (
            <>
              <label className="row-between">
                <span>Todo el día</span>
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              </label>

              {!allDay && (
                <div className="time-row">
                  <div>
                    <label className="small">Desde</label>
                    <input value={timeFrom} onChange={(e) => handleTimeInput(setTimeFrom)(e.target.value)} placeholder="HH:MM" maxLength={5} />
                  </div>
                  <div>
                    <label className="small">Hasta (opcional)</label>
                    <input value={timeTo} onChange={(e) => handleTimeInput(setTimeTo)(e.target.value)} placeholder="HH:MM" maxLength={5} />
                  </div>
                </div>
              )}

              {conflicts.length > 0 && (
                <div className="conflict-banner">
                  ⚠ Ya tenés {conflicts.length === 1 ? 'un trabajo agendado' : `${conflicts.length} trabajos agendados`} ese día: {conflicts.map((j) => `${j.title} (${j.timeFrom}–${j.timeTo})`).join(', ')}. Se puede guardar igual.
                </div>
              )}

              <label>Categoría</label>
              <div className="pill-row">
                {CATEGORY_ORDER.map((cat) => {
                  const meta = CATEGORY_META[cat];
                  const active = category === cat;
                  return (
                    <button
                      type="button"
                      key={cat}
                      className={`cat-pill${active ? ' cat-pill-active' : ''}`}
                      style={{ borderColor: meta.color, background: active ? meta.color : undefined }}
                      onClick={() => setCategory(cat)}
                    >
                      <span className="cat-dot" style={{ background: active ? '#fff' : meta.color }} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>

              <label>Lista (materiales, tareas, lo que necesites)</label>
              {checklist.map((ci) => (
                <div key={ci.id} className="checklist-row">
                  <input type="checkbox" checked={ci.checked} onChange={() => toggleChecklistItem(ci.id)} />
                  <span className={ci.checked ? 'checked' : ''}>{ci.text}</span>
                  <button type="button" className="checklist-remove" onClick={() => removeChecklistItem(ci.id)} aria-label="Quitar">✕</button>
                </div>
              ))}
              <div className="checklist-add-row">
                <input
                  value={newItemText}
                  onChange={(e) => setNewItemText(e.target.value)}
                  placeholder="Agregar ítem..."
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); } }}
                />
                <button type="button" onClick={addChecklistItem}>+</button>
              </div>

              <label>Fotos (opcional)</label>
              <div className="photo-row">
                {photosDraft.map((url) => (
                  <div key={url} className="photo-thumb-wrap">
                    <img src={url} className="photo-thumb" alt="" />
                    <button type="button" className="photo-remove" onClick={() => onRemovePhoto(url)} aria-label="Quitar foto">✕</button>
                  </div>
                ))}
                {photosDraft.length < 6 && (
                  <label className="photo-add-btn">
                    {uploadingPhoto ? '...' : '+'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      disabled={uploadingPhoto}
                      onChange={(e) => { if (e.target.files?.length) onAddPhotos(e.target.files); e.target.value = ''; }}
                    />
                  </label>
                )}
              </div>
            </>
          )}
        </div>

        <div className="editor-footer">
          {entry && (
            <button type="button" className="btn btn-outline editor-delete" onClick={onDelete} disabled={saving}>Eliminar</button>
          )}
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}
