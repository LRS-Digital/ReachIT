import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { describeError } from '../common/describe-error.js';

const API_BASE = 'https://open.tiktokapis.com/v2/post/publish';
const VIDEO_LIST_URL = 'https://open.tiktokapis.com/v2/video/list/';

// Zeitfenster, in dem ein Video als "gerade eben veroeffentlicht" gilt
const VERIFY_FENSTER_SEKUNDEN = 15 * 60;

interface TiktokVideo {
  id: string;
  title?: string;
  create_time: number;
  share_url?: string;
}

// TikTok verlangt Chunks >= 5MB, außer die Gesamtdatei ist kleiner
const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const TARGET_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB pro Chunk (außer letzter)

interface ChunkPlan {
  chunkSize: number;
  totalChunkCount: number;
}

function planChunks(totalSize: number): ChunkPlan {
  if (totalSize <= MIN_CHUNK_SIZE) {
    // Kleine Datei: alles in einem Request
    return { chunkSize: totalSize, totalChunkCount: 1 };
  }
  const totalChunkCount = Math.floor(totalSize / TARGET_CHUNK_SIZE);
  return { chunkSize: TARGET_CHUNK_SIZE, totalChunkCount };
}

@Injectable()
export class TiktokPublishService {
  /**
   * Schritt 1: Video-Upload initialisieren, TikTok gibt eine Upload-URL zurück.
   */
  async initVideoUpload(
    accessToken: string,
    videoBuffer: Buffer,
    caption: string,
  ): Promise<{ publishId: string; uploadUrl: string }> {
    const totalSize = videoBuffer.length;
    const { chunkSize, totalChunkCount } = planChunks(totalSize);

    const response = await axios.post(
      `${API_BASE}/video/init/`,
      {
        post_info: {
          title: caption,
          // Bis zum TikTok-Audit dürfen Posts nur privat sichtbar sein
          privacy_level: 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: totalSize,
          chunk_size: chunkSize,
          total_chunk_count: totalChunkCount,
        },
        post_mode: 'DIRECT_POST',
        media_type: 'VIDEO',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    return {
      publishId: response.data.data.publish_id,
      uploadUrl: response.data.data.upload_url,
    };
  }

  /**
   * Schritt 2: Video-Bytes in Chunks an die Upload-URL senden.
   */
  async uploadVideoChunks(
    uploadUrl: string,
    videoBuffer: Buffer,
  ): Promise<void> {
    const totalSize = videoBuffer.length;
    const { chunkSize, totalChunkCount } = planChunks(totalSize);

    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      // Letzter Chunk bekommt den kompletten Rest (auch wenn > chunkSize)
      const end =
        i === totalChunkCount - 1 ? totalSize - 1 : start + chunkSize - 1;
      const chunk = videoBuffer.subarray(start, end + 1);

      await axios.put(uploadUrl, chunk, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': chunk.length.toString(),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
    }
  }

  /**
   * Schritt 3: Status abfragen, bis die Verarbeitung abgeschlossen ist.
   *
   * Gibt die Post-ID zurueck, die TikTok in der Statusantwort mitliefert
   * (`publicaly_available_post_id`, Schreibfehler stammt von TikTok). Die ist
   * nicht dieselbe wie die publish_id: Letztere identifiziert den
   * Upload-Vorgang, erstere das fertige Video. Bei privaten Posts
   * (privacy_level SELF_ONLY) laesst TikTok das Feld unter Umstaenden weg -
   * deshalb wird die vollstaendige Antwort geloggt, sonst laesst sich
   * spaeter nicht nachvollziehen, was TikTok tatsaechlich gemacht hat.
   */
  async waitUntilPublished(
    publishId: string,
    accessToken: string,
  ): Promise<string | undefined> {
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.post(
        `${API_BASE}/status/fetch/`,
        { publish_id: publishId },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const status = response.data.data.status;

      if (status === 'PUBLISH_COMPLETE') {
        console.log(
          'TikTok Publish abgeschlossen:',
          JSON.stringify(response.data.data),
        );

        const postIds = response.data.data.publicaly_available_post_id;
        return Array.isArray(postIds) ? String(postIds[0]) : undefined;
      }
      if (status === 'FAILED') {
        throw new Error(
          `TikTok-Veröffentlichung fehlgeschlagen: ${JSON.stringify(response.data.data)}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error(
      'Timeout: TikTok hat das Video nicht rechtzeitig verarbeitet.',
    );
  }

  /**
   * Fragt nach dem Veröffentlichen bei TikTok zurück, ob das Video wirklich
   * auf dem Konto liegt.
   *
   * PUBLISH_COMPLETE aus dem Status-Polling ist nur TikToks Zusage, die
   * Verarbeitung abgeschlossen zu haben. Eine Post-ID liefert die Antwort
   * nicht: Das Feld heißt `publicaly_available_post_id`, und bei privaten
   * Posts (privacy_level SELF_ONLY) gibt es keine öffentlich verfügbare ID.
   * Gemessen an der Datenlage bleibt nur der Umweg über die Videoliste des
   * Kontos - passt der Titel und ist das Video gerade eben entstanden, ist es
   * dasselbe.
   *
   * Braucht den Scope `video.list`. Konten, die vorher verbunden wurden,
   * müssen einmal neu verbinden, sonst antwortet TikTok mit einem Scope-Fehler
   * und die Verifizierung meldet verified: false.
   */
  async verifyPost(
    accessToken: string,
    caption: string,
  ): Promise<{ verified: boolean; externalId?: string; permalink?: string }> {
    try {
      const response = await axios.post(
        `${VIDEO_LIST_URL}?fields=id,title,create_time,share_url`,
        { max_count: 10 },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log(
        'TikTok Videoliste:',
        JSON.stringify(response.data?.data ?? response.data),
      );

      const videos: TiktokVideo[] = response.data?.data?.videos ?? [];
      const grenze = Math.floor(Date.now() / 1000) - VERIFY_FENSTER_SEKUNDEN;

      const treffer = videos.find(
        (video) =>
          video.create_time >= grenze &&
          (caption === '' || video.title === caption),
      );

      if (!treffer) return { verified: false };

      return {
        verified: true,
        externalId: String(treffer.id),
        permalink: treffer.share_url,
      };
    } catch (err) {
      console.error('TikTok Verify Fehler:', describeError(err));
      return { verified: false };
    }
  }
}
