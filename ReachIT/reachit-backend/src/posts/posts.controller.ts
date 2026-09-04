import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Body,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { R2Service } from '../storage/r2.service.js';
import { InstagramPublishService } from '../instagram/instagram-publish.service.js';
import { TiktokPublishService } from '../tiktok/tiktok-publish.service.js';
import { ThreadsPublishService } from '../threads/threads-publish.service.js';
import { LinkedinPublishService } from '../linkedin/linkedin-publish.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { TokenRefreshService } from '../tokens/token-refresh.service.js';
import type { MediaType, Platform } from './post-log.service.js';
import { MultiPostService } from './multi-post.service.js';
import type { ConnectedAccount } from '../tokens/token-refresh.service.js';
import { PostLogService } from './post-log.service.js';
import { describeError } from '../common/describe-error.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@Controller('posts')
@UseGuards(SupabaseAuthGuard)
export class PostsController {
  constructor(
    private readonly r2: R2Service,
    private readonly instagram: InstagramPublishService,
    private readonly tiktok: TiktokPublishService,
    private readonly threads: ThreadsPublishService,
    private readonly linkedin: LinkedinPublishService,
    private readonly supabase: SupabaseService,
    private readonly tokens: TokenRefreshService,
    private readonly postLog: PostLogService,
    private readonly multiPost: MultiPostService,
  ) {}

  // Instagram Feed-Post (Bild)
  @Post('instagram')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postToInstagram(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
    @Body('caption') caption: string,
    @Res() res: Response,
  ) {
    if (!file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'instagram', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = await this.tokens.ensureFresh(account);
      const imageUrl = await this.r2.uploadFile(file.buffer, file.mimetype);

      const containerId = await this.instagram.createImageContainer(
        account.platform_user_id,
        accessToken,
        imageUrl,
        caption ?? '',
      );

      await this.instagram.waitUntilReady(containerId, accessToken);

      const mediaId = await this.instagram.publishContainer(
        account.platform_user_id,
        accessToken,
        containerId,
      );

      // Echte Bestätigung: nachfragen, ob der Post wirklich existiert
      const verifyResult = await this.instagram.verifyPost(
        mediaId,
        accessToken,
      );

      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'image',
        platform: 'instagram',
        status: 'success',
        externalId: mediaId,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        durationMs: Date.now() - startTime,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });

      return res.json({
        success: true,
        mediaId,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });
    } catch (err) {
      console.error('Instagram Post Fehler:', describeError(err));
      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'image',
        platform: 'instagram',
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
      });
      return res.status(500).json({ error: 'Posten fehlgeschlagen.' });
    }
  }

  // Instagram Reel (Video)
  @Post('instagram-reel')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postInstagramReel(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
    @Body('caption') caption: string,
    @Body('shareToFeed') shareToFeed: string,
    @Res() res: Response,
  ) {
    if (!file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'instagram', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = await this.tokens.ensureFresh(account);
      const videoUrl = await this.r2.uploadFile(file.buffer, file.mimetype);

      const shouldShareToFeed = shareToFeed !== 'false';

      const containerId = await this.instagram.createReelContainer(
        account.platform_user_id,
        accessToken,
        videoUrl,
        caption ?? '',
        shouldShareToFeed,
      );

      await this.instagram.waitUntilReady(containerId, accessToken);

      const mediaId = await this.instagram.publishContainer(
        account.platform_user_id,
        accessToken,
        containerId,
      );

      const verifyResult = await this.instagram.verifyPost(
        mediaId,
        accessToken,
      );

      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'video',
        platform: 'instagram',
        status: 'success',
        externalId: mediaId,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        durationMs: Date.now() - startTime,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });

      return res.json({
        success: true,
        mediaId,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });
    } catch (err) {
      console.error('Instagram Reel Fehler:', describeError(err));
      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'video',
        platform: 'instagram',
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
      });
      return res.status(500).json({ error: 'Reel-Posten fehlgeschlagen.' });
    }
  }

  // TikTok Video-Post
  @Post('tiktok')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postToTiktok(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() userId: string,
    @Body('caption') caption: string,
    @Res() res: Response,
  ) {
    if (!file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'tiktok', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = await this.tokens.ensureFresh(account);

      const { publishId, uploadUrl } = await this.tiktok.initVideoUpload(
        accessToken,
        file.buffer,
        caption ?? '',
      );

      await this.tiktok.uploadVideoChunks(uploadUrl, file.buffer);
      // TikTok liefert die echte Post-ID erst in der Statusantwort. Ohne sie
      // stuende in external_id nur die publish_id des Upload-Vorgangs.
      const postId = await this.tiktok.waitUntilPublished(
        publishId,
        accessToken,
      );

      // PUBLISH_COMPLETE ist nur TikToks Zusage, die Verarbeitung abgeschlossen
      // zu haben. Erst die Videoliste des Kontos beweist, dass das Video
      // wirklich dort liegt - und liefert nebenbei die echte Post-ID.
      const bestaetigung = await this.tiktok.verifyPost(
        accessToken,
        caption ?? '',
      );

      // Ohne den Scope video.list ist keine Rueckfrage moeglich. Dann gilt
      // wieder PUBLISH_COMPLETE als Bestaetigung - dieselbe Aussagekraft wie
      // vor der Rueckfrage, nur eben ohne Link zum Video.
      const verified = bestaetigung ? bestaetigung.verified : true;

      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'video',
        platform: 'tiktok',
        status: 'success',
        externalId: bestaetigung?.externalId ?? postId ?? publishId,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        durationMs: Date.now() - startTime,
        verified,
        postUrl: bestaetigung?.permalink,
      });

      return res.json({
        success: true,
        publishId,
        verified,
        postUrl: bestaetigung?.permalink,
      });
    } catch (err) {
      console.error('TikTok Post Fehler:', describeError(err));
      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'video',
        platform: 'tiktok',
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
      });
      return res.status(500).json({ error: 'Posten fehlgeschlagen.' });
    }
  }

  // Threads Post (Text, optional mit Bild/Video)
  @Post('threads')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postToThreads(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() userId: string,
    @Body('text') text: string,
    @Res() res: Response,
  ) {
    if (!text && !file) {
      return res
        .status(400)
        .json({ error: 'Entweder Text oder ein Bild/Video wird benötigt.' });
    }

    // Für das Logging brauchen wir den Media-Typ auch im Fehlerfall,
    // deshalb außerhalb des try-Blocks bestimmen.
    const mediaType: 'text' | 'image' | 'video' = file
      ? file.mimetype.startsWith('video/')
        ? 'video'
        : 'image'
      : 'text';

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'threads', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = await this.tokens.ensureFresh(account);

      let imageUrl: string | undefined;
      let videoUrl: string | undefined;

      if (file) {
        const uploadedUrl = await this.r2.uploadFile(
          file.buffer,
          file.mimetype,
        );
        if (mediaType === 'video') {
          videoUrl = uploadedUrl;
        } else {
          imageUrl = uploadedUrl;
        }
      }

      const containerId = await this.threads.createContainer(
        account.platform_user_id,
        accessToken,
        text ?? '',
        imageUrl,
        videoUrl,
      );

      // Nur Videos brauchen Verarbeitungszeit, Bilder sind sofort bereit
      if (videoUrl) {
        await this.threads.waitUntilReady(containerId, accessToken);
      }

      const postId = await this.threads.publishContainer(
        account.platform_user_id,
        accessToken,
        containerId,
      );

      const verifyResult = await this.threads.verifyPost(postId, accessToken);

      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: text ?? '',
        mediaType,
        platform: 'threads',
        status: 'success',
        externalId: postId,
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });

      return res.json({
        success: true,
        postId,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });
    } catch (err) {
      console.error('Threads Post Fehler:', describeError(err));
      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: text ?? '',
        mediaType,
        platform: 'threads',
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
      });
      return res.status(500).json({ error: 'Posten fehlgeschlagen.' });
    }
  }

  // LinkedIn Post (Text, optional mit Bild)
  @Post('linkedin')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postToLinkedin(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() userId: string,
    @Body('text') text: string,
    @Res() res: Response,
  ) {
    if (!text) {
      return res.status(400).json({ error: 'Text wird benötigt.' });
    }

    const mediaType: 'text' | 'image' = file ? 'image' : 'text';

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'linkedin', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = await this.tokens.ensureFresh(account);
      const personUrn = `urn:li:person:${account.platform_user_id}`;

      let imageUrn: string | undefined;
      if (file) {
        imageUrn = await this.linkedin.uploadImage(
          personUrn,
          accessToken,
          file.buffer,
        );
      }

      const postUrn = await this.linkedin.createPost(
        personUrn,
        accessToken,
        text,
        imageUrn,
      );

      const verifyResult = this.linkedin.verifyPost(postUrn);

      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: text,
        mediaType,
        platform: 'linkedin',
        status: 'success',
        externalId: postUrn,
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });

      return res.json({
        success: true,
        postUrn,
        verified: verifyResult.verified,
        postUrl: verifyResult.permalink,
      });
    } catch (err) {
      console.error('LinkedIn Post Fehler:', describeError(err));
      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: text,
        mediaType,
        platform: 'linkedin',
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
        fileSizeBytes: file?.size,
        mimeType: file?.mimetype,
        durationMs: Date.now() - startTime,
      });
      return res.status(500).json({ error: 'Posten fehlgeschlagen.' });
    }
  }

  /**
   * Zentraler Endpunkt: ein Aufruf, mehrere Plattformen.
   *
   * Erzeugt genau einen posts-Eintrag mit einem post_targets-Eintrag je Ziel.
   * Die Ziele laufen parallel, und ein Fehlschlag auf einer Plattform lässt
   * die anderen unberührt - die Antwort nennt jede Plattform einzeln.
   *
   * Bewusst synchron statt über eine Warteschlange: Der Aufrufer bekommt das
   * Ergebnis pro Plattform sofort. BullMQ wird interessant, sobald geplante
   * Posts oder Wiederholversuche dazukommen - dann ändert sich aber auch der
   * Vertrag, weil der Endpunkt nur noch eine Auftragsnummer zurückgeben kann.
   */
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postToAll(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() userId: string,
    @Body('platforms') platforms: string,
    @Body('text') text: string,
    @Body('shareToFeed') shareToFeed: string,
    @Res() res: Response,
  ) {
    const ziele = (platforms ?? '')
      .split(',')
      .map((eintrag) => eintrag.trim().toLowerCase())
      .filter(Boolean) as Platform[];

    if (ziele.length === 0) {
      return res.status(400).json({
        error: 'Keine Plattformen angegeben (Feld "platforms", kommagetrennt).',
      });
    }

    if (!text && !file) {
      return res
        .status(400)
        .json({ error: 'Entweder Text oder eine Datei wird benötigt.' });
    }

    const mediaType: MediaType = file
      ? file.mimetype.startsWith('video/')
        ? 'video'
        : 'image'
      : 'text';

    // Ein Eintrag für den gesamten Post, die Ziele hängen darunter
    const postId = await this.postLog.legePostAn({
      userId,
      caption: text ?? '',
      mediaType,
      fileSizeBytes: file?.size,
      mimeType: file?.mimetype,
    });

    const konten = await this.ladeVerbundeneKonten(userId, ziele);

    // Nur einmal nach R2 hochladen, auch wenn Instagram und Threads beide eine
    // URL brauchen - der Upload ist der teuerste Teil des Vorgangs.
    let mediaUrl: string | undefined;

    if (file && ziele.some((ziel) => this.multiPost.brauchtMedienUrl(ziel))) {
      mediaUrl = await this.r2.uploadFile(file.buffer, file.mimetype);
    }

    const ergebnisse = await Promise.all(
      ziele.map((ziel) =>
        this.veroeffentlicheZiel({
          ziel,
          konten,
          postId,
          text: text ?? '',
          file,
          mediaType,
          mediaUrl,
          shareToFeed: shareToFeed !== 'false',
        }),
      ),
    );

    const erfolge = ergebnisse.filter((ergebnis) => ergebnis.success);
    await this.postLog.setzePostStatus(postId, erfolge.length > 0);

    // 502, wenn keine einzige Plattform erreicht wurde - ein Teilerfolg gilt
    // als Erfolg, das Detail steht in results.
    return res.status(erfolge.length > 0 ? 200 : 502).json({
      success: erfolge.length > 0,
      postId,
      erfolgreich: erfolge.length,
      gesamt: ziele.length,
      results: ergebnisse,
    });
  }

  /**
   * Veröffentlicht auf genau einer Plattform und protokolliert das Ergebnis.
   * Wirft nie - ein Fehler wird zum Fehlschlag dieses einen Ziels, damit die
   * übrigen Plattformen davon unberührt bleiben.
   */
  private async veroeffentlicheZiel(kontext: {
    ziel: Platform;
    konten: Map<string, ConnectedAccount>;
    postId: string | null;
    text: string;
    file?: Express.Multer.File;
    mediaType: MediaType;
    mediaUrl?: string;
    shareToFeed: boolean;
  }): Promise<{
    platform: Platform;
    success: boolean;
    verified?: boolean;
    externalId?: string;
    postUrl?: string;
    error?: string;
  }> {
    const { ziel, konten, postId, text, file, mediaType, mediaUrl } = kontext;
    const startZeit = Date.now();

    const alsFehlschlag = async (
      nachricht: string,
      connectedAccountId?: string,
    ) => {
      await this.postLog.protokolliereZiel(postId, {
        platform: ziel,
        status: 'failed',
        connectedAccountId,
        errorMessage: nachricht,
        durationMs: Date.now() - startZeit,
      });

      return { platform: ziel, success: false, error: nachricht };
    };

    const konto = konten.get(ziel);

    if (!konto) {
      return alsFehlschlag(`Kein ${ziel}-Konto für diesen Nutzer verbunden.`);
    }

    // Untaugliche Kombinationen vorab abfangen, statt erst bei der
    // Plattform-API aufzuschlagen - etwa ein Textpost an TikTok.
    const medienFehler = this.multiPost.pruefeMedienart(ziel, mediaType);

    if (medienFehler) {
      return alsFehlschlag(medienFehler, konto.id);
    }

    try {
      const accessToken = await this.tokens.ensureFresh(konto);

      const ergebnis = await this.multiPost.veroeffentliche({
        platform: ziel,
        platformUserId: konto.platform_user_id,
        accessToken,
        text,
        mediaType,
        fileBuffer: file?.buffer,
        mediaUrl,
        shareToFeed: kontext.shareToFeed,
      });

      await this.postLog.protokolliereZiel(postId, {
        platform: ziel,
        status: 'success',
        connectedAccountId: konto.id,
        externalId: ergebnis.externalId,
        durationMs: Date.now() - startZeit,
        verified: ergebnis.verified,
        postUrl: ergebnis.postUrl,
      });

      return {
        platform: ziel,
        success: true,
        verified: ergebnis.verified,
        externalId: ergebnis.externalId,
        postUrl: ergebnis.postUrl,
      };
    } catch (err) {
      console.error(`Multi-Post Fehler (${ziel}):`, describeError(err));

      return alsFehlschlag(
        err instanceof Error ? err.message : String(err),
        konto.id,
      );
    }
  }

  private async ladeVerbundeneKonten(
    userId: string,
    platforms: Platform[],
  ): Promise<Map<string, ConnectedAccount>> {
    const { data, error } = await this.supabase.client
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .in('platform', platforms);

    if (error) {
      console.error('Konten laden fehlgeschlagen:', error);
    }

    const konten = new Map<string, ConnectedAccount>();

    for (const konto of (data ?? []) as ConnectedAccount[]) {
      konten.set(konto.platform, konto);
    }

    return konten;
  }

  private async getConnectedAccount(
    userId: string,
    platform: string,
    res: Response,
  ) {
    const { data: account, error } = await this.supabase.client
      .from('connected_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('platform', platform)
      .single();

    if (error || !account) {
      res
        .status(404)
        .json({ error: `Kein ${platform}-Konto für diesen Nutzer verbunden.` });
      return null;
    }

    return account;
  }
}
