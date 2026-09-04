import { Injectable } from '@nestjs/common';
import { InstagramPublishService } from '../instagram/instagram-publish.service.js';
import { TiktokPublishService } from '../tiktok/tiktok-publish.service.js';
import { ThreadsPublishService } from '../threads/threads-publish.service.js';
import { LinkedinPublishService } from '../linkedin/linkedin-publish.service.js';
import type { MediaType, Platform } from './post-log.service.js';

export interface VeroeffentlichungsAuftrag {
  platform: Platform;
  platformUserId: string;
  accessToken: string;
  text: string;
  mediaType: MediaType;
  /** Rohe Bytes - TikTok und LinkedIn laden direkt hoch, ohne R2-Umweg. */
  fileBuffer?: Buffer;
  /** Presigned R2-URL - Instagram und Threads holen sich das Medium selbst ab. */
  mediaUrl?: string;
  shareToFeed: boolean;
}

export interface VeroeffentlichungsErgebnis {
  externalId?: string;
  verified: boolean;
  postUrl?: string;
}

/**
 * Welche Plattform welche Medienarten annimmt.
 *
 * Instagram braucht zwingend ein Medium, TikTok zwingend ein Video, LinkedIn
 * kann bisher kein Video, Threads kann alles. Wer hier fehlt, wird nicht
 * bedient - das ist die einzige Stelle, an der neue Plattformen freigeschaltet
 * werden muessen.
 */
const UNTERSTUETZTE_MEDIENARTEN: Partial<Record<Platform, MediaType[]>> = {
  instagram: ['image', 'video'],
  tiktok: ['video'],
  threads: ['text', 'image', 'video'],
  linkedin: ['text', 'image'],
};

/** Plattformen, deren Medium ueber eine oeffentlich erreichbare URL laeuft. */
const BRAUCHT_MEDIEN_URL: Platform[] = ['instagram', 'threads'];

@Injectable()
export class MultiPostService {
  constructor(
    private readonly instagram: InstagramPublishService,
    private readonly tiktok: TiktokPublishService,
    private readonly threads: ThreadsPublishService,
    private readonly linkedin: LinkedinPublishService,
  ) {}

  /**
   * Prueft vorab, ob die Plattform mit dieser Medienart ueberhaupt etwas
   * anfangen kann. So wird ein untaugliches Ziel sauber als Fehlschlag
   * protokolliert, statt erst bei der Plattform-API aufzuschlagen.
   */
  pruefeMedienart(platform: Platform, mediaType: MediaType): string | null {
    const erlaubt = UNTERSTUETZTE_MEDIENARTEN[platform];

    if (!erlaubt) {
      return `${platform} wird noch nicht unterstuetzt.`;
    }

    if (!erlaubt.includes(mediaType)) {
      const arten = erlaubt.join(', ');
      return `${platform} nimmt ${mediaType} nicht an (moeglich: ${arten}).`;
    }

    return null;
  }

  brauchtMedienUrl(platform: Platform): boolean {
    return BRAUCHT_MEDIEN_URL.includes(platform);
  }

  async veroeffentliche(
    auftrag: VeroeffentlichungsAuftrag,
  ): Promise<VeroeffentlichungsErgebnis> {
    switch (auftrag.platform) {
      case 'instagram':
        return this.aufInstagram(auftrag);
      case 'threads':
        return this.aufThreads(auftrag);
      case 'tiktok':
        return this.aufTiktok(auftrag);
      case 'linkedin':
        return this.aufLinkedin(auftrag);
      default:
        throw new Error(`${auftrag.platform} wird noch nicht unterstuetzt.`);
    }
  }

  private async aufInstagram(
    auftrag: VeroeffentlichungsAuftrag,
  ): Promise<VeroeffentlichungsErgebnis> {
    // Instagram hat keinen eigenen Feed-Video-Endpunkt mehr, alle Videos
    // laufen ueber Reels. shareToFeed zeigt sie zusaetzlich im Feed-Grid.
    const containerId =
      auftrag.mediaType === 'video'
        ? await this.instagram.createReelContainer(
            auftrag.platformUserId,
            auftrag.accessToken,
            auftrag.mediaUrl!,
            auftrag.text,
            auftrag.shareToFeed,
          )
        : await this.instagram.createImageContainer(
            auftrag.platformUserId,
            auftrag.accessToken,
            auftrag.mediaUrl!,
            auftrag.text,
          );

    await this.instagram.waitUntilReady(containerId, auftrag.accessToken);

    const mediaId = await this.instagram.publishContainer(
      auftrag.platformUserId,
      auftrag.accessToken,
      containerId,
    );

    const bestaetigung = await this.instagram.verifyPost(
      mediaId,
      auftrag.accessToken,
    );

    return {
      externalId: mediaId,
      verified: bestaetigung.verified,
      postUrl: bestaetigung.permalink,
    };
  }

  private async aufThreads(
    auftrag: VeroeffentlichungsAuftrag,
  ): Promise<VeroeffentlichungsErgebnis> {
    const imageUrl =
      auftrag.mediaType === 'image' ? auftrag.mediaUrl : undefined;
    const videoUrl =
      auftrag.mediaType === 'video' ? auftrag.mediaUrl : undefined;

    const containerId = await this.threads.createContainer(
      auftrag.platformUserId,
      auftrag.accessToken,
      auftrag.text,
      imageUrl,
      videoUrl,
    );

    // Nur Videos brauchen Verarbeitungszeit, Bilder sind sofort bereit
    if (videoUrl) {
      await this.threads.waitUntilReady(containerId, auftrag.accessToken);
    }

    const postId = await this.threads.publishContainer(
      auftrag.platformUserId,
      auftrag.accessToken,
      containerId,
    );

    const bestaetigung = await this.threads.verifyPost(
      postId,
      auftrag.accessToken,
    );

    return {
      externalId: postId,
      verified: bestaetigung.verified,
      postUrl: bestaetigung.permalink,
    };
  }

  private async aufTiktok(
    auftrag: VeroeffentlichungsAuftrag,
  ): Promise<VeroeffentlichungsErgebnis> {
    const { publishId, uploadUrl } = await this.tiktok.initVideoUpload(
      auftrag.accessToken,
      auftrag.fileBuffer!,
      auftrag.text,
    );

    await this.tiktok.uploadVideoChunks(uploadUrl, auftrag.fileBuffer!);

    const postId = await this.tiktok.waitUntilPublished(
      publishId,
      auftrag.accessToken,
    );

    const bestaetigung = await this.tiktok.verifyPost(
      auftrag.accessToken,
      auftrag.text,
    );

    // null heisst: Rueckfrage nicht moeglich (Scope video.list fehlt). Dann
    // gilt PUBLISH_COMPLETE als Bestaetigung, wie vor Einfuehrung der
    // Rueckfrage - nur ohne Link zum Video.
    return {
      externalId: bestaetigung?.externalId ?? postId ?? publishId,
      verified: bestaetigung ? bestaetigung.verified : true,
      postUrl: bestaetigung?.permalink,
    };
  }

  private async aufLinkedin(
    auftrag: VeroeffentlichungsAuftrag,
  ): Promise<VeroeffentlichungsErgebnis> {
    const personUrn = `urn:li:person:${auftrag.platformUserId}`;

    const imageUrn =
      auftrag.mediaType === 'image' && auftrag.fileBuffer
        ? await this.linkedin.uploadImage(
            personUrn,
            auftrag.accessToken,
            auftrag.fileBuffer,
          )
        : undefined;

    const postUrn = await this.linkedin.createPost(
      personUrn,
      auftrag.accessToken,
      auftrag.text,
      imageUrn,
    );

    const bestaetigung = this.linkedin.verifyPost(postUrn);

    return {
      externalId: postUrn,
      verified: bestaetigung.verified,
      postUrl: bestaetigung.permalink,
    };
  }
}
