import { Injectable } from '@nestjs/common';
import axios from 'axios';

const GRAPH_BASE = 'https://graph.instagram.com';

@Injectable()
export class InstagramPublishService {
  /**
   * Schritt 1: Erstellt einen "Media Container" - entweder ein Bild
   * (Feed-Post) oder ein Reel (Video).
   */
  async createImageContainer(
    igUserId: string,
    accessToken: string,
    imageUrl: string,
    caption: string,
  ): Promise<string> {
    const response = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
      params: {
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      },
    });
    return response.data.id;
  }

  /**
   * Erstellt einen Video-Container. Instagram veröffentlicht alle Videos
   * technisch als "Reel" (media_type=REELS) - es gibt keinen separaten
   * klassischen Feed-Video-Endpunkt mehr. Über shareToFeed steuerst du,
   * ob das Video zusätzlich im normalen Feed-Grid erscheint (true) oder
   * nur im Reels-Tab sichtbar ist (false).
   */
  async createReelContainer(
    igUserId: string,
    accessToken: string,
    videoUrl: string,
    caption: string,
    shareToFeed: boolean = true,
  ): Promise<string> {
    const response = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption,
        share_to_feed: shareToFeed,
        access_token: accessToken,
      },
    });
    return response.data.id;
  }

  /**
   * Schritt 2: Wartet, bis Instagram das Medium fertig verarbeitet hat.
   * Reels brauchen länger als Bilder (bis zu mehreren Minuten laut Meta),
   * daher großzügigeres Polling-Intervall und Timeout.
   */
  async waitUntilReady(containerId: string, accessToken: string): Promise<void> {
    const maxAttempts = 40; // 40 x 5s = ~3,3 Minuten Timeout

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.get(`${GRAPH_BASE}/${containerId}`, {
        params: { fields: 'status_code', access_token: accessToken },
      });

      const status = response.data.status_code;

      if (status === 'FINISHED') return;
      if (status === 'ERROR') {
        throw new Error('Instagram konnte das Medium nicht verarbeiten.');
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error('Timeout: Instagram hat das Medium nicht rechtzeitig verarbeitet.');
  }

  /**
   * Schritt 3: Veröffentlicht den fertigen Container als echten Post/Reel.
   */
  async publishContainer(
    igUserId: string,
    accessToken: string,
    containerId: string,
  ): Promise<string> {
    const response = await axios.post(
      `${GRAPH_BASE}/${igUserId}/media_publish`,
      null,
      {
        params: {
          creation_id: containerId,
          access_token: accessToken,
        },
      },
    );
    return response.data.id;
  }
}
