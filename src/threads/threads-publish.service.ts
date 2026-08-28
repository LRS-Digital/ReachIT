import { Injectable } from '@nestjs/common';
import axios from 'axios';

const GRAPH_BASE = 'https://graph.threads.net';

@Injectable()
export class ThreadsPublishService {
  /**
   * Schritt 1: Erstellt einen Post-Container (Text oder Bild).
   */
  async createContainer(
    threadsUserId: string,
    accessToken: string,
    text: string,
    imageUrl?: string,
  ): Promise<string> {
    const params: Record<string, string> = {
      media_type: imageUrl ? 'IMAGE' : 'TEXT',
      text,
      access_token: accessToken,
    };

    if (imageUrl) {
      params.image_url = imageUrl;
    }

    const response = await axios.post(
      `${GRAPH_BASE}/${threadsUserId}/threads`,
      null,
      { params },
    );
    return response.data.id;
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
}
