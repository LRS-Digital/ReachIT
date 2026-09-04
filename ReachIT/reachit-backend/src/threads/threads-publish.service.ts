import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { describeError } from '../common/describe-error.js';

const GRAPH_BASE = 'https://graph.threads.net';

// Erst kurze, dann längere Abstände: Text- und Bild-Container sind meist nach
// ein bis zwei Sekunden fertig, Videos brauchen Minuten.
const SCHNELLE_VERSUCHE = 10;
const SCHNELL_MS = 2000;
const LANGSAME_VERSUCHE = 30;
const LANGSAM_MS = 10000;

// Wiederholungen, wenn Threads den gerade erzeugten Container noch nicht kennt
const PUBLISH_VERSUCHE = 4;
const PUBLISH_WARTEN_MS = 3000;

/**
 * Erkennt den Fall "Container existiert noch nicht" an Metas Fehlercodes.
 * code 24 / error_subcode 4279009 = "Media Not Found".
 */
function istContainerNochNichtDa(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;

  const fehler = (err.response?.data as { error?: Record<string, unknown> })
    ?.error;

  return fehler?.code === 24 && fehler?.error_subcode === 4279009;
}

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
   * Wartet, bis der Container veröffentlichungsbereit ist.
   *
   * Gilt für alle Medienarten, nicht nur Video. Threads legt Container
   * asynchron an - wird zu früh veröffentlicht, antwortet die API mit
   * "Media Not Found". Das Status-Feld heißt bei Threads "status" (nicht
   * "status_code" wie bei Instagram) und fehlt bei Text-Containern teilweise
   * ganz; dann gibt es auch nichts abzuwarten.
   */
  async waitUntilReady(
    containerId: string,
    accessToken: string,
  ): Promise<void> {
    const maxAttempts = SCHNELLE_VERSUCHE + LANGSAME_VERSUCHE;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const response = await axios.get(`${GRAPH_BASE}/${containerId}`, {
        params: { fields: 'status,error_message', access_token: accessToken },
      });

      const status = response.data.status;

      if (!status || status === 'FINISHED') return;

      if (status === 'ERROR') {
        throw new Error(
          `Threads konnte das Medium nicht verarbeiten: ${response.data.error_message}`,
        );
      }

      await new Promise((resolve) =>
        setTimeout(
          resolve,
          attempt < SCHNELLE_VERSUCHE ? SCHNELL_MS : LANGSAM_MS,
        ),
      );
    }

    throw new Error(
      'Timeout: Threads hat das Medium nicht rechtzeitig verarbeitet.',
    );
  }

  /**
   * Schritt 2: Veröffentlicht den fertigen Container.
   *
   * Auch nach erfolgreichem Statuscheck kann Threads den Container kurzzeitig
   * noch nicht kennen - eine reine Wettlaufsituation, die beim nächsten
   * Versuch durchgeht. Genau dieser Fall wird wiederholt, jeder andere Fehler
   * fliegt sofort weiter.
   */
  async publishContainer(
    threadsUserId: string,
    accessToken: string,
    containerId: string,
  ): Promise<string> {
    for (let versuch = 0; versuch < PUBLISH_VERSUCHE; versuch++) {
      try {
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
      } catch (err) {
        const letzterVersuch = versuch === PUBLISH_VERSUCHE - 1;

        if (letzterVersuch || !istContainerNochNichtDa(err)) throw err;

        await new Promise((fertig) => setTimeout(fertig, PUBLISH_WARTEN_MS));
      }
    }

    // Unerreichbar: Die Schleife kehrt entweder zurück oder wirft.
    throw new Error('Threads-Veröffentlichung fehlgeschlagen.');
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
