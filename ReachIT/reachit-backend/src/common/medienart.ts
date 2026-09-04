import type { MediaType } from '../posts/post-log.service.js';

/**
 * Endungen als Rückfallebene, wenn der mimetype nichts hergibt.
 */
const VIDEO_ENDUNGEN = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'];
const BILD_ENDUNGEN = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];

/**
 * Bestimmt, ob eine hochgeladene Datei Bild oder Video ist.
 *
 * Der mimetype allein reicht nicht: `curl -F "file=@video.mp4"` schickt
 * `application/octet-stream`, und viele HTTP-Clients tun das ebenso. Wer nur
 * auf `video/` prüft, hält jedes so hochgeladene Video für ein Bild - und
 * schickt es dann als Bild an die Plattformen, die das teilweise sogar
 * annehmen und etwas Kaputtes veröffentlichen.
 *
 * Deshalb: erst mimetype, dann Dateiendung. Bleibt beides unklar, wird der
 * Fehler geworfen, statt zu raten.
 */
export function erkenneMedienart(file: {
  mimetype?: string;
  originalname?: string;
}): MediaType {
  const mimetype = (file.mimetype ?? '').toLowerCase();

  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';

  const endung =
    (file.originalname ?? '').split('.').pop()?.toLowerCase() ?? '';

  if (VIDEO_ENDUNGEN.includes(endung)) return 'video';
  if (BILD_ENDUNGEN.includes(endung)) return 'image';

  throw new Error(
    `Dateityp nicht erkannt (mimetype "${file.mimetype ?? 'keiner'}", Endung "${endung || 'keine'}"). Bild oder Video wird benötigt.`,
  );
}
