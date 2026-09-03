import { Injectable } from '@nestjs/common';
import axios from 'axios';

const API_BASE = 'https://open.tiktokapis.com/v2/post/publish';

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
  async uploadVideoChunks(uploadUrl: string, videoBuffer: Buffer): Promise<void> {
    const totalSize = videoBuffer.length;
    const { chunkSize, totalChunkCount } = planChunks(totalSize);

    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      // Letzter Chunk bekommt den kompletten Rest (auch wenn > chunkSize)
      const end = i === totalChunkCount - 1 ? totalSize - 1 : start + chunkSize - 1;
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
   */
  async waitUntilPublished(publishId: string, accessToken: string): Promise<void> {
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

      if (status === 'PUBLISH_COMPLETE') return;
      if (status === 'FAILED') {
        throw new Error(
          `TikTok-Veröffentlichung fehlgeschlagen: ${JSON.stringify(response.data.data)}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error('Timeout: TikTok hat das Video nicht rechtzeitig verarbeitet.');
  }
}
