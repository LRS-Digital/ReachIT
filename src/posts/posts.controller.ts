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
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly r2: R2Service,
    private readonly instagram: InstagramPublishService,
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

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

    try {
      // 1. Verbundenen Instagram-Account des Nutzers holen
      const { data: account, error: accountError } = await this.supabase.client
        .from('connected_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('platform', 'instagram')
        .single();

      if (accountError || !account) {
        return res
          .status(404)
          .json({ error: 'Kein Instagram-Konto für diesen Nutzer verbunden.' });
      }

      const accessToken = this.encryption.decrypt(account.access_token);

      // 2. Bild zu R2 hochladen -> temporäre öffentliche URL
      const imageUrl = await this.r2.uploadFile(file.buffer, file.mimetype);

      // 3. Media Container bei Instagram erstellen
      const containerId = await this.instagram.createContainer(
        account.platform_user_id,
        accessToken,
        imageUrl,
        caption ?? '',
      );

      // 4. Warten, bis Instagram das Bild verarbeitet hat
      await this.instagram.waitUntilReady(containerId, accessToken);

      // 5. Container veröffentlichen
      const mediaId = await this.instagram.publishContainer(
        account.platform_user_id,
        accessToken,
        containerId,
      );

      return res.json({ success: true, mediaId });
    } catch (err) {
      console.error('Instagram Post Fehler:', err);
      return res.status(500).json({ error: 'Posten fehlgeschlagen.' });
    }
  }
}
