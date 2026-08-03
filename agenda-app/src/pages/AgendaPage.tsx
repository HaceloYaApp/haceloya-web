import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection, getDocs, query as fsQuery, where as fsWhere, doc, getDoc,
  onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import MonthCalendar from '../components/MonthCalendar';
import EntryEditor from '../components/EntryEditor';
import type { AgendaCategory, CustomEntry, DisplayItem, JobEntry } from '../utils/agendaTypes';
import { CATEGORY_META } from '../utils/agendaTypes';
import { formatDate, toLocalISODate } from '../utils/dateUtils';
import { getJobEmoji, getJobTypeLabel } from '../utils/postLabel';
import { computeProposalTotal, formatARS } from '../utils/money';
import { uploadAgendaPhoto } from '../utils/imageUpload';
import { LEDGER_ADMIN_UIDS } from '../utils/ledgerAdmins';
import LedgerPage from './LedgerPage';
import './AgendaPage.css';

export default function AgendaPage() {
  const { user } = useAuth();
  const uid = user!.uid;
  const isLedgerAdmin = LEDGER_ADMIN_UIDS.includes(uid);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [customEntries, setCustomEntries] = useState<CustomEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Antes un error de red/permission-denied acá dejaba jobs/customEntries en
  // [] sin avisar nada — la UI mostraba "No tenés nada agendado", indistinguible
  // de que en verdad no hay nada. Con este banner al menos queda claro que
  // falló la carga, no que la agenda está vacía.
  const [loadError, setLoadError] = useState('');
  // Resumen de transacciones: sólo entra quien loguea con una cuenta de
  // LEDGER_ADMIN_UIDS — el botón para abrirlo ni siquiera aparece para el
  // resto (ver agenda-header-actions más abajo). La seguridad real vive en
  // el backend (assertLedgerAdmin), esto sólo evita mostrar la opción.
  const [showLedger, setShowLedger] = useState(false);

  // Agenda unificada: antes esto traía sólo el lado activo (Particular O
  // Profesional, según un toggle) — acá se traen SIEMPRE los dos lados y
  // cada trabajo queda etiquetado con viewerRole según qué consulta lo trajo.
  const loadAgenda = useCallback(async () => {
    setLoading(true);
    try {
      const coll = collection(db, 'posts');
      const statusGroups: string[][] = [['iniciado'], ['notificacion'], ['finalizada', 'finalizado'], ['cancelado']];
      const queryDefs: Array<{ statuses: string[]; viewerRole: 'particular' | 'profesional' }> = [];
      for (const statuses of statusGroups) {
        queryDefs.push({ statuses, viewerRole: 'particular' });
        queryDefs.push({ statuses, viewerRole: 'profesional' });
      }
      const snaps = await Promise.all(queryDefs.map(({ statuses, viewerRole }) => {
        const statusFilter = statuses.length > 1 ? fsWhere('status', 'in', statuses) : fsWhere('status', '==', statuses[0]);
        const roleFilter = viewerRole === 'profesional'
          ? fsWhere('acceptedProposal.proposerUid', '==', uid)
          : fsWhere('authorUid', '==', uid);
        return getDocs(fsQuery(coll, statusFilter, roleFilter));
      }));

      const taggedDocs: Array<{ docSnap: any; viewerRole: 'particular' | 'profesional' }> = [];
      snaps.forEach((snap, i) => {
        const { viewerRole } = queryDefs[i];
        snap.docs.forEach((docSnap) => taggedDocs.push({ docSnap, viewerRole }));
      });

      const jobList: JobEntry[] = [];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await Promise.all(taggedDocs.map(async ({ docSnap, viewerRole }) => {
        const data: any = docSnap.data() || {};
        const id = docSnap.id;
        const title = data.title || 'Pedido';
        const category = data.category || 'servicio';
        const mode = data.mode || data.type || 'Servicio';
        const status = data.status || 'iniciado';

        const acceptedProposal = data.acceptedProposal || {};
        const { base: totalCost, fee: serviceFee, warrantyCost, total: grandTotal } = computeProposalTotal({
          totalCost: acceptedProposal.totalCost,
          price: acceptedProposal.price,
          warranty: acceptedProposal.warranty,
        });
        const estimatedTime = acceptedProposal.estimatedWorkTime || acceptedProposal.estimatedTime || null;

        let otherUserName = '';
        try {
          const otherUid = viewerRole === 'profesional' ? data.authorUid : acceptedProposal.proposerUid;
          if (otherUid) {
            const userDoc = await getDoc(doc(db, 'users', otherUid));
            const userData: any = userDoc.data();
            if (userData) {
              otherUserName = `${userData.firstName || ''} ${userData.lastName || ''}`.trim()
                || userData.username
                || (viewerRole === 'profesional' ? 'Particular' : 'Profesional');
            }
          }
        } catch { /* noop */ }

        const weeklySchedule = data.weeklySchedule as { [day: string]: { from: string; to: string } } | undefined;
        if (weeklySchedule && Object.keys(weeklySchedule).length > 0) {
          const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
          for (let weekOffset = -4; weekOffset < 8; weekOffset++) {
            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
              const checkDate = new Date(today);
              checkDate.setDate(today.getDate() + (weekOffset * 7) + dayOffset);
              const dayNm = dayNames[checkDate.getDay()];
              const schedule = weeklySchedule[dayNm];
              if (schedule) {
                jobList.push({
                  id, title, date: toLocalISODate(checkDate),
                  timeFrom: schedule.from || '—', timeTo: schedule.to || '—',
                  category, mode, dayOfWeek: dayNm, otherUserName,
                  estimatedTime: estimatedTime || undefined,
                  totalCost, serviceFee, warrantyCost, grandTotal, status,
                  viewerRole,
                });
              }
            }
          }
        } else {
          const dates: string[] = Array.isArray(data.dates) ? data.dates : [];
          const timeFrom = data.timeFrom || data.horaDesde || data.horaInicio || '—';
          const timeTo = data.timeTo || data.horaHasta || data.horaFin || '—';
          dates.forEach((dateStr) => {
            jobList.push({
              id, title, date: dateStr, timeFrom, timeTo, category, mode, otherUserName,
              estimatedTime: estimatedTime || undefined,
              totalCost, serviceFee, warrantyCost, grandTotal, status,
              viewerRole,
            });
          });
        }
      }));

      jobList.sort((a, b) => (a.date === b.date ? a.timeFrom.localeCompare(b.timeFrom) : a.date.localeCompare(b.date)));
      setJobs(jobList);
      setLoadError('');
    } catch (e) {
      console.error('[Agenda] Error cargando trabajos', e);
      setJobs([]);
      setLoadError('No pudimos cargar tus trabajos. Revisá tu conexión y volvé a intentar.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { loadAgenda(); }, [loadAgenda]);

  useEffect(() => {
    const ref = collection(db, 'users', uid, 'agendaEntries');
    const unsub = onSnapshot(ref, (snap) => {
      const arr: CustomEntry[] = [];
      snap.forEach((d) => {
        const v: any = d.data() || {};
        arr.push({
          id: d.id,
          title: String(v.title || ''),
          notes: String(v.notes || ''),
          date: String(v.date || ''),
          allDay: !!v.allDay,
          timeFrom: String(v.timeFrom || ''),
          timeTo: String(v.timeTo || ''),
          category: (['personal', 'compras', 'trabajo', 'salud', 'otro'].includes(v.category) ? v.category : 'personal') as AgendaCategory,
          checklist: Array.isArray(v.checklist) ? v.checklist : [],
          photos: Array.isArray(v.photos) ? v.photos.filter((p: any) => typeof p === 'string') : [],
          isNote: v.isNote === true,
        });
      });
      setCustomEntries(arr);
      setLoadError('');
    }, (err) => {
      console.error('[Agenda] Error entradas propias', err);
      setLoadError('No pudimos cargar tu agenda. Revisá tu conexión y volvé a intentar.');
    });
    return () => unsub();
  }, [uid]);

  const activeJobsByDate = useMemo(() => {
    const grouped: Record<string, JobEntry[]> = {};
    jobs.filter((j) => j.status === 'iniciado' || j.status === 'notificacion')
      .forEach((j) => { (grouped[j.date] ||= []).push(j); });
    return grouped;
  }, [jobs]);

  const allItems = useMemo<DisplayItem[]>(() => {
    const arr: DisplayItem[] = [];
    jobs.forEach((job) => arr.push({ kind: 'job', date: job.date, sortTime: job.timeFrom === '—' ? '' : job.timeFrom, job }));
    customEntries.forEach((entry) => arr.push({ kind: 'custom', date: entry.date, sortTime: entry.allDay ? '' : entry.timeFrom, entry }));
    return arr;
  }, [jobs, customEntries]);

  const itemsByDate = useMemo(() => {
    const grouped: Record<string, DisplayItem[]> = {};
    allItems.forEach((it) => { (grouped[it.date] ||= []).push(it); });
    Object.values(grouped).forEach((list) => list.sort((a, b) => a.sortTime.localeCompare(b.sortTime)));
    return grouped;
  }, [allItems]);

  const jobDotColor = (status?: string) => (String(status || '').toLowerCase() === 'cancelado' ? '#EB5757' : '#27AE60');

  // Un trabajo donde el usuario es el profesional (no quien lo pidió) se
  // destaca en el calendario con el recuadrito de cinta negra/amarilla.
  const markedDates = useMemo(() => {
    const md: Record<string, { dots: string[]; hasProJob: boolean }> = {};
    Object.keys(itemsByDate).forEach((date) => {
      const colorSet = new Set<string>();
      let hasProJob = false;
      itemsByDate[date].forEach((it) => {
        if (it.kind === 'job') {
          colorSet.add(jobDotColor(it.job.status));
          if (it.job.viewerRole === 'profesional') hasProJob = true;
        } else {
          colorSet.add(CATEGORY_META[it.entry.category].color);
        }
      });
      md[date] = { dots: Array.from(colorSet), hasProJob };
    });
    return md;
  }, [itemsByDate]);

  const displayedItems = useMemo(() => {
    if (selectedDate) return itemsByDate[selectedDate] || [];
    const todayStr = toLocalISODate(new Date());
    return allItems
      .filter((it) => it.date >= todayStr)
      .sort((a, b) => (a.date === b.date ? a.sortTime.localeCompare(b.sortTime) : a.date.localeCompare(b.date)));
  }, [selectedDate, itemsByDate, allItems]);

  // ---------------- Editor de entradas propias ----------------
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CustomEntry | null>(null);
  const [photosDraft, setPhotosDraft] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);

  const openNewEntry = () => {
    setEditingEntry(null);
    setPhotosDraft([]);
    setEditorOpen(true);
  };
  const openEditEntry = (entry: CustomEntry) => {
    setEditingEntry(entry);
    setPhotosDraft(entry.photos);
    setEditorOpen(true);
  };

  const handleAddPhotos = async (files: FileList) => {
    if (uploadingPhoto) return;
    const remaining = 6 - photosDraft.length;
    if (remaining <= 0) { alert('Podés agregar hasta 6 fotos por entrada.'); return; }
    setUploadingPhoto(true);
    try {
      const toUpload = Array.from(files).slice(0, remaining);
      for (const file of toUpload) {
        try {
          const url = await uploadAgendaPhoto(uid, file);
          setPhotosDraft((prev) => (prev.length >= 6 ? prev : [...prev, url]));
        } catch (e) {
          console.warn('[Agenda] No se pudo subir una foto', e);
        }
      }
    } finally {
      setUploadingPhoto(false);
    }
  };
  const handleRemovePhoto = (url: string) => setPhotosDraft((prev) => prev.filter((p) => p !== url));

  const handleSaveEntry = async (payload: Omit<CustomEntry, 'id'>) => {
    setSaving(true);
    try {
      // Sólo se escriben los campos que maneja la web: si la entrada tiene
      // recordatorio configurado desde la app mobile, esos campos quedan
      // intactos (updateDoc no toca lo que no está en el payload).
      const data = { ...payload, updatedAt: serverTimestamp() };
      if (editingEntry) {
        await updateDoc(doc(db, 'users', uid, 'agendaEntries', editingEntry.id), data);
      } else {
        await addDoc(collection(db, 'users', uid, 'agendaEntries'), { ...data, createdAt: serverTimestamp() });
      }
      setEditorOpen(false);
    } catch (e) {
      console.error('[Agenda] No se pudo guardar la entrada', e);
      alert('No se pudo guardar. Intentá nuevamente.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async () => {
    if (!editingEntry) return;
    if (!confirm('¿Eliminar esta entrada? Esta acción no se puede deshacer.')) return;
    setSaving(true);
    try {
      await deleteDoc(doc(db, 'users', uid, 'agendaEntries', editingEntry.id));
      setEditorOpen(false);
    } catch {
      alert('No se pudo eliminar.');
    } finally {
      setSaving(false);
    }
  };

  const toggleChecklistItemQuick = async (entry: CustomEntry, itemId: string) => {
    const next = entry.checklist.map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
    try {
      await updateDoc(doc(db, 'users', uid, 'agendaEntries', entry.id), { checklist: next, updatedAt: serverTimestamp() });
    } catch { /* noop */ }
  };

  const totalCount = displayedItems.length;

  if (showLedger) {
    return <LedgerPage onBack={() => setShowLedger(false)} />;
  }

  return (
    <div className="agenda-page">
      <header className="agenda-header">
        <div>
          <h1>Mi agenda</h1>
          <p className="agenda-sub">
            {selectedDate ? `${totalCount} ${totalCount === 1 ? 'entrada' : 'entradas'} del día` : `${totalCount} ${totalCount === 1 ? 'entrada' : 'entradas'} próximas`}
          </p>
        </div>
        <div className="agenda-header-actions">
          {isLedgerAdmin && (
            <button type="button" className="btn btn-outline" onClick={() => setShowLedger(true)}>Resumen</button>
          )}
          <button type="button" className="btn btn-outline logout-btn" onClick={() => signOut(auth)}>Salir</button>
        </div>
      </header>

      <div className="hazard-stripe" style={{ marginBottom: 16 }} />

      {loadError && <div className="agenda-error">{loadError}</div>}

      {loading ? (
        <div className="agenda-loading">Cargando...</div>
      ) : (
        <>
          <MonthCalendar markedDates={markedDates} selectedDate={selectedDate} onSelectDate={(d) => setSelectedDate((prev) => (prev === d ? null : d))} />

          {selectedDate && (
            <button type="button" className="filter-badge" onClick={() => setSelectedDate(null)}>
              {formatDate(selectedDate)} · {totalCount} {totalCount === 1 ? 'entrada' : 'entradas'} ✕
            </button>
          )}

          <div className="agenda-list">
            {displayedItems.length === 0 && (
              <div className="agenda-empty">
                <p>{selectedDate ? 'No tenés nada para este día.' : 'No tenés nada agendado por ahora.'}</p>
                <button type="button" className="btn btn-outline" onClick={openNewEntry}>+ Agregar una entrada</button>
              </div>
            )}

            {displayedItems.map((item) => {
              if (item.kind === 'job') {
                const job = item.job;
                return (
                  <div key={`job-${job.id}-${job.date}-${job.timeFrom}`} className="job-card">
                    <div className="job-card-header">
                      <span className="job-emoji">{getJobEmoji(job)}</span>
                      <div className="job-card-title-wrap">
                        <div className="job-card-title">{job.title}</div>
                        <div className="job-card-type">{getJobTypeLabel(job)}{job.dayOfWeek ? ` · ${job.dayOfWeek}` : ''}</div>
                      </div>
                      {(job.status === 'finalizada' || job.status === 'finalizado') && <span className="badge badge-success">✓ Finalizado</span>}
                      {job.status === 'cancelado' && <span className="badge badge-danger">✕ Cancelado</span>}
                    </div>
                    <div className="job-card-body">
                      {job.otherUserName && <div className="job-info-row"><span>👤 {job.viewerRole === 'profesional' ? 'Particular:' : 'Profesional:'}</span><span>{job.otherUserName}</span></div>}
                      <div className="job-info-row"><span>📅 Fecha:</span><span>{formatDate(job.date)}</span></div>
                      <div className="job-info-row"><span>🕐 Horario:</span><span>{job.timeFrom} — {job.timeTo}</span></div>
                      {job.estimatedTime && <div className="job-info-row"><span>⏱️ Tiempo est.:</span><span>{job.estimatedTime}</span></div>}
                      {job.grandTotal != null && job.grandTotal > 0 && (
                        <div className="job-info-row"><span>💰 Precio:</span><span className="job-price">${formatARS(job.grandTotal)}</span></div>
                      )}
                    </div>
                  </div>
                );
              }
              const entry = item.entry;

              if (entry.isNote) {
                return (
                  <div key={`custom-${entry.id}`} className="note-card" onClick={() => openEditEntry(entry)}>
                    <span className="note-card-icon">📝</span>
                    <p className="note-card-text">{entry.notes}</p>
                  </div>
                );
              }

              const meta = CATEGORY_META[entry.category];
              const checkedCount = entry.checklist.filter((c) => c.checked).length;
              return (
                <div key={`custom-${entry.id}`} className="custom-card" style={{ borderLeftColor: meta.color }} onClick={() => openEditEntry(entry)}>
                  <div className="custom-card-header">
                    <div className="job-card-title-wrap">
                      <div className="job-card-title">{entry.title}</div>
                      <div className="job-card-type">
                        {meta.label}
                        {entry.allDay ? ' · Todo el día' : (entry.timeFrom ? ` · ${entry.timeFrom}${entry.timeTo ? `–${entry.timeTo}` : ''}` : '')}
                      </div>
                    </div>
                  </div>
                  {!!entry.notes && <p className="custom-notes">{entry.notes}</p>}
                  {entry.checklist.length > 0 && (
                    <div className="checklist-wrap">
                      <span className="checklist-progress">{checkedCount}/{entry.checklist.length}</span>
                      {entry.checklist.map((ci) => (
                        <div key={ci.id} className="checklist-quick-row" onClick={(e) => { e.stopPropagation(); toggleChecklistItemQuick(entry, ci.id); }}>
                          <input type="checkbox" checked={ci.checked} readOnly />
                          <span className={ci.checked ? 'checked' : ''}>{ci.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.photos.length > 0 && (
                    <div className="card-photo-row">
                      {entry.photos.map((url) => <img key={url} src={url} className="card-photo-thumb" alt="" />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button type="button" className="fab" onClick={openNewEntry} aria-label="Agregar entrada">+</button>
        </>
      )}

      {editorOpen && (
        <EntryEditor
          entry={editingEntry}
          initialDate={selectedDate || toLocalISODate(new Date())}
          conflictJobsForDate={(date) => activeJobsByDate[date] || []}
          saving={saving}
          uploadingPhoto={uploadingPhoto}
          onSave={handleSaveEntry}
          onDelete={handleDeleteEntry}
          onAddPhotos={handleAddPhotos}
          onRemovePhoto={handleRemovePhoto}
          photosDraft={photosDraft}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
