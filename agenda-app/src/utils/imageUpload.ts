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

// Mismo límite que MAX_UPLOAD_DIMENSION en el repo mobile (src/utils/imageUpload.ts,
// hallazgo de costo de la tanda 10 de la auditoría): sin esto, una foto de
// cámara (3000-4000px) se subía tal cual codificada en base64 (+33% overhead),
// varios MB por foto. Acá el equivalente browser vía <canvas> (sin dependencias
// nuevas) — mismo tope de lado y misma calidad JPEG.
const MAX_UPLOAD_DIMENSION = 1600;
const UPLOAD_JPEG_QUALITY = 0.75;

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Redimensiona vía canvas si la imagen es más grande que MAX_UPLOAD_DIMENSION;
// si ya es chica, se sube tal cual (mismo criterio que resizeForUpload en
// mobile: no agrandar una foto angosta). Si algo falla (formato raro, canvas
// no disponible), se cae al dataUrl original entero antes que no subir nada.
async function resizeForUpload(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(objectUrl);
    const longestSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (!longestSide || longestSide <= MAX_UPLOAD_DIMENSION) {
      return await fileToDataUrl(file);
    }
    const scale = MAX_UPLOAD_DIMENSION / longestSide;
    const width = Math.round(img.naturalWidth * scale);
    const height = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return await fileToDataUrl(file);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', UPLOAD_JPEG_QUALITY);
  } catch (e) {
    console.warn('[imageUpload] No se pudo redimensionar, subiendo original:', e);
    return await fileToDataUrl(file);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Mismo path que la app mobile (users/{uid}/agenda/...) — cubierto por
// storage.rules como carpeta 100% privada del usuario.
export async function uploadAgendaPhoto(uid: string, file: File): Promise<string> {
  const dataUrl = await resizeForUpload(file);
  // El resize siempre reduce a JPEG; si se cayó al original, mantiene la
  // extensión real del archivo.
  const ext = dataUrl.startsWith('data:image/jpeg') ? 'jpg' : extFromMime(file.type || '');
  const sRef = storageRef(storage, `users/${uid}/agenda/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
  await uploadString(sRef, dataUrl, 'data_url');
  return getDownloadURL(sRef);
}
