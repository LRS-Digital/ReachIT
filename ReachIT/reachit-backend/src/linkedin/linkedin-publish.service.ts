import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { describeError } from '../common/describe-error.js';

const API_BASE = 'https://api.linkedin.com/rest';
// LinkedIn verlangt einen Versions-Header im Format YYYYMM
const LINKEDIN_VERSION = '202608';

function buildHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': LINKEDIN_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
    'Content-Type': 'application/json',
  };
}

@Injectable()
export class LinkedinPublishService {
  /**
   * Lädt ein Bild hoch und gibt die Bild-URN zurück, die dann im Post
   * referenziert wird. Zweistufig: erst URL anfordern, dann Bytes senden.
   */
  async uploadImage(
    personUrn: string,
    accessToken: string,
    imageBuffer: Buffer,
  ): Promise<string> {
    const initResponse = await axios.post(
      `${API_BASE}/images?action=initializeUpload`,
      { initializeUploadRequest: { owner: personUrn } },
      { headers: buildHeaders(accessToken) },
    );

    const { uploadUrl, image: imageUrn } = initResponse.data.value;

    await axios.put(uploadUrl, imageBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    return imageUrn;
  }

  /**
   * Erstellt und veröffentlicht einen Post in einem Schritt (LinkedIn hat
   * kein separates Container/Publish-Modell wie Instagram/Threads).
   */
  async createPost(
    personUrn: string,
    accessToken: string,
    text: string,
    imageUrn?: string,
  ): Promise<string> {
    const body: Record<string, any> = {
      author: personUrn,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (imageUrn) {
      body.content = { media: { id: imageUrn } };
    }

    const response = await axios.post(`${API_BASE}/posts`, body, {
      headers: buildHeaders(accessToken),
    });

    // Die Post-ID kommt bei LinkedIn im Response-Header, nicht im Body
    return response.headers['x-restli-id'];
  }

  /**
   * Fragt nach dem Veröffentlichen aktiv zurück, ob der Post wirklich
   * existiert (echte Bestätigung statt nur der ersten API-Antwort zu
   * vertrauen). Der Permalink lässt sich bei LinkedIn direkt aus der
   * URN konstruieren, sobald die GET-Anfrage erfolgreich ist.
   */
  async verifyPost(
    postUrn: string,
    accessToken: string,
  ): Promise<{ verified: boolean; permalink?: string }> {
    try {
      const encodedUrn = encodeURIComponent(postUrn);
      await axios.get(`${API_BASE}/posts/${encodedUrn}`, {
        headers: buildHeaders(accessToken),
      });
      return {
        verified: true,
        permalink: `https://www.linkedin.com/feed/update/${postUrn}/`,
      };
    } catch (err) {
      console.error('LinkedIn Verify Fehler:', describeError(err));
      return { verified: false };
    }
  }
}
