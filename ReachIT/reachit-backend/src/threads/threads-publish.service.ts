import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { describeError } from '../common/describe-error.js';

const GRAPH_BASE = 'https://graph.threads.net';

@Injectable()
export class ThreadsPublishService {
  /**
   * Schritt 1: Erstellt einen Post-Container (Text, Bild oder Video).
   * Es darf höchstens EINE der beiden URLs gesetzt sein.
   */
  async createContainer(
    threadsUserId: string,
    accessToken: string,
    text: string,
    imageUrl?: string,
    videoUrl?: string,
  ): Promise<string> {
    const params: Record<string, string> = {
      media_type: videoUrl ? 'VIDEO' : imageUrl ? 'IMAGE' : 'TEXT',
      text,
      access_token: accessToken,
    };

    if (imageUrl) {
      params.image_url = imageUrl;
    }
    if (videoUrl) {
      params.video_url = videoUrl;
    }

    const response = await axios.post(
      `${GRAPH_BASE}/${threadsUserId}/threads`,
      null,
      { params },
    );
    return response.data.id;
  }

  /**
   * Nur für Videos nötig: Threads verarbeitet Videos asynchron.
   * Bilder werden laut Meta sofort verarbeitet, brauchen kein Warten.
   * Status-Feld heißt bei Threads "status" (nicht "status_code" wie bei
   * Instagram). Meta empfiehlt ca. einmal pro Minute für max. 5 Minuten
   * abzufragen.
   */
  async waitUntilReady(
    containerId: string,
    accessToken: string,
  ): Promise<void> {
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.get(`${GRAPH_BASE}/${containerId}`, {
        params: { fields: 'status,error_message', access_token: accessToken },
      });

      const status = response.data.status;

      if (status === 'FINISHED') return;
      if (status === 'ERROR') {
        throw new Error(
          `Threads konnte das Video nicht verarbeiten: ${response.data.error_message}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 60000));
    }

    throw new Error(
      'Timeout: Threads hat das Video nicht rechtzeitig verarbeitet.',
    );
  }

  /**
   * Schritt 2: Veröffentlicht den fertigen Container.
   */
  async publishContainer(
    threadsUserId: string,
    accessToken: string,
    containerId: string,
  ): Promise<string> {
    const response = await axios.post(
      `${GRAPH_BASE}/${threadsUserId}/threads_publish`,
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

  /**
   * Fragt nach dem Veröffentlichen aktiv zurück, ob der Post wirklich
   * existiert (echte Bestätigung statt nur der ersten API-Antwort zu
   * vertrauen). Gibt den permalink zurück, falls erfolgreich.
   */
  async verifyPost(
    postId: string,
    accessToken: string,
  ): Promise<{ verified: boolean; permalink?: string }> {
    try {
      const response = await axios.get(`${GRAPH_BASE}/${postId}`, {
        params: { fields: 'id,permalink', access_token: accessToken },
      });
      return { verified: true, permalink: response.data.permalink };
    } catch (err) {
      console.error('Threads Verify Fehler:', describeError(err));
      return { verified: false };
    }
  }
}
