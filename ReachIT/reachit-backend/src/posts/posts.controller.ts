import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
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
import { EncryptionService } from '../crypto/encryption.service.js';
import { PostLogService } from './post-log.service.js';
import { describeError } from '../common/describe-error.js';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly r2: R2Service,
    private readonly instagram: InstagramPublishService,
    private readonly tiktok: TiktokPublishService,
    private readonly threads: ThreadsPublishService,
    private readonly linkedin: LinkedinPublishService,
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly postLog: PostLogService,
  ) {}

  // Instagram Feed-Post (Bild)
  @Post('instagram')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async postToInstagram(
    @UploadedFile() file: Express.Multer.File,
    @Body('userId') userId: string,
    @Body('caption') caption: string,
    @Res() res: Response,
  ) {
    if (!file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'Keine userId angegeben.' });
    }

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'instagram', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = this.encryption.decrypt(account.access_token);
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
    @Body('userId') userId: string,
    @Body('caption') caption: string,
    @Body('shareToFeed') shareToFeed: string,
    @Res() res: Response,
  ) {
    if (!file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'Keine userId angegeben.' });
    }

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'instagram', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = this.encryption.decrypt(account.access_token);
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
    @Body('userId') userId: string,
    @Body('caption') caption: string,
    @Res() res: Response,
  ) {
    if (!file) {
      return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'Keine userId angegeben.' });
    }

    let connectedAccountId: string | undefined;
    const startTime = Date.now();

    try {
      const account = await this.getConnectedAccount(userId, 'tiktok', res);
      if (!account) return;

      connectedAccountId = account.id;

      const accessToken = this.encryption.decrypt(account.access_token);

      const { publishId, uploadUrl } = await this.tiktok.initVideoUpload(
        accessToken,
        file.buffer,
        caption ?? '',
      );

      await this.tiktok.uploadVideoChunks(uploadUrl, file.buffer);
      await this.tiktok.waitUntilPublished(publishId, accessToken);

      // TikToks Status-Polling bis PUBLISH_COMPLETE IST bereits die
      // echte Bestätigung - kein zusätzlicher Call nötig
      await this.postLog.logAttempt({
        userId,
        connectedAccountId,
        caption: caption ?? '',
        mediaType: 'video',
        platform: 'tiktok',
        status: 'success',
        externalId: publishId,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        durationMs: Date.now() - startTime,
        verified: true,
      });

      return res.json({ success: true, publishId, verified: true });
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
    @Body('userId') userId: string,
    @Body('text') text: string,
    @Res() res: Response,
  ) {
    if (!userId) {
      return res.status(400).json({ error: 'Keine userId angegeben.' });
    }
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

      const accessToken = this.encryption.decrypt(account.access_token);

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
    @Body('userId') userId: string,
    @Body('text') text: string,
    @Res() res: Response,
  ) {
    if (!userId) {
      return res.status(400).json({ error: 'Keine userId angegeben.' });
    }
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

      const accessToken = this.encryption.decrypt(account.access_token);
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
