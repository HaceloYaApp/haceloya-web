import { ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { storage } from '../firebase';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

// Mismo path que la app mobile (users/{uid}/agenda/...) — cubierto por
// storage.rules como carpeta 100% privada del usuario.
export async function uploadAgendaPhoto(uid: string, file: File): Promise<string> {
  const dataUrl = await fileToDataUrl(file);
  const ext = extFromMime(file.type || '');
  const sRef = storageRef(storage, `users/${uid}/agenda/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  await uploadString(sRef, dataUrl, 'data_url');
  return getDownloadURL(sRef);
}
