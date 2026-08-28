import { Injectable } from '@nestjs/common';
import axios from 'axios';

const GRAPH_BASE = 'https://graph.instagram.com';

@Injectable()
export class InstagramPublishService {
  /**
   * Schritt 1: Instagram lädt das Bild von imageUrl herunter und erstellt
   * einen "Media Container" (noch nicht veröffentlicht).
   */
  async createContainer(
    igUserId: string,
    accessToken: string,
    imageUrl: string,
    caption: string,
  ): Promise<string> {
    // DEBUG: Prüfen, welche ID das Token tatsächlich für sich selbst meldet
    const meResponse = await axios.get(`${GRAPH_BASE}/me`, {
      params: { fields: 'id,username', access_token: accessToken },
    });
    console.log('DEBUG /me Antwort:', JSON.stringify(meResponse.data));
    console.log('DEBUG gespeicherte platform_user_id:', igUserId);

    const response = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
      params: {
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      },
    });
    return response.data.id; // Container-ID
  }

  /**
   * Schritt 2: Wartet, bis Instagram das Bild fertig verarbeitet hat.
   * Fragt alle 3 Sekunden den Status ab (max. 20 Versuche = ~1 Minute).
   */
  async waitUntilReady(containerId: string, accessToken: string): Promise<void> {
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.get(`${GRAPH_BASE}/${containerId}`, {
        params: { fields: 'status_code', access_token: accessToken },
      });

      const status = response.data.status_code;

      if (status === 'FINISHED') return;
      if (status === 'ERROR') {
        throw new Error('Instagram konnte das Medium nicht verarbeiten.');
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error('Timeout: Instagram hat das Medium nicht rechtzeitig verarbeitet.');
  }

  /**
   * Schritt 3: Veröffentlicht den fertigen Container als echten Post.
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
    return response.data.id; // veröffentlichte Media-ID
  }
}
