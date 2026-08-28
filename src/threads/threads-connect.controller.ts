import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import axios from 'axios';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

const THREADS_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/threads/callback';

@Controller('connect')
export class ThreadsConnectController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  // Schritt 1: Nutzer klickt "Threads verbinden" -> Redirect zu Threads
  @Get('threads')
  connectThreads(@Query('userId') userId: string, @Res() res: Response) {
    const params = new URLSearchParams({
      client_id: process.env.THREADS_CLIENT_ID!,
      redirect_uri: THREADS_REDIRECT_URI,
      scope: 'threads_basic,threads_content_publish',
      response_type: 'code',
      state: userId,
    });

    return res.redirect(
      `https://threads.net/oauth/authorize?${params.toString()}`,
    );
  }

  // Schritt 2: Threads leitet mit "code" hierher zurück
  @Get('threads/callback')
  async threadsCallback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    if (!code) {
      return res.status(400).send('Kein Autorisierungscode erhalten.');
    }

    try {
      // Kurzlebiges Access Token holen. Antwort als Rohtext lesen (nicht
      // automatisch parsen), da die user_id genau wie bei Instagram eine
      // große Zahl sein kann, die JavaScript sonst ungenau rundet.
      const tokenResponse = await axios.post(
        'https://graph.threads.net/oauth/access_token',
        new URLSearchParams({
          client_id: process.env.THREADS_CLIENT_ID!,
          client_secret: process.env.THREADS_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          redirect_uri: THREADS_REDIRECT_URI,
          code,
        }),
        {
          responseType: 'text',
          transformResponse: [(data) => data],
        },
      );

      const rawBody: string = tokenResponse.data;
      const accessTokenMatch = rawBody.match(/"access_token"\s*:\s*"([^"]+)"/);
      const userIdMatch = rawBody.match(/"user_id"\s*:\s*"?(\d+)"?/);

      if (!accessTokenMatch || !userIdMatch) {
        throw new Error(
          `Konnte access_token oder user_id nicht extrahieren: ${rawBody}`,
        );
      }

      const shortLivedToken = accessTokenMatch[1];
      const platformUserId = userIdMatch[1];

      // Kurzlebiges gegen langlebiges Token (60 Tage) tauschen
      const longLivedResponse = await axios.get(
        'https://graph.threads.net/access_token',
        {
          params: {
            grant_type: 'th_exchange_token',
            client_secret: process.env.THREADS_CLIENT_SECRET!,
            access_token: shortLivedToken,
          },
        },
      );

      const { access_token: longLivedToken, expires_in } =
        longLivedResponse.data;

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      const { error } = await this.supabase.client
        .from('connected_accounts')
        .upsert(
          {
            user_id: userId,
            platform: 'threads',
            platform_user_id: platformUserId,
            access_token: this.encryption.encrypt(longLivedToken),
            expires_at: expiresAt.toISOString(),
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,platform,platform_user_id' },
        );

      if (error) throw error;

      return res.send(
        'Threads-Konto erfolgreich verbunden! Du kannst dieses Fenster schließen.',
      );
    } catch (err) {
      console.error('Threads OAuth Fehler:', err);
      return res.status(500).send('Verbindung fehlgeschlagen.');
    }
  }
}
