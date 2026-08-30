import { Controller, Get, Post, Query, Body, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import axios from 'axios';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

const THREADS_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/threads/callback';
const THREADS_SCOPES = 'threads_basic,threads_content_publish,threads_delete';

/**
 * Entschlüsselt und verifiziert Metas "signed_request"-Format
 * (base64url-kodierte Signatur + base64url-kodierte JSON-Payload,
 * getrennt durch einen Punkt), das bei Deauthorize- und
 * Datenlöschungs-Callbacks mitgeschickt wird.
 */
function parseSignedRequest(signedRequest: string, secret: string): any {
  const [encodedSig, payload] = signedRequest.split('.');

  const sig = Buffer.from(
    encodedSig.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );
  const dataString = Buffer.from(
    payload.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  ).toString();

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest();

  if (!crypto.timingSafeEqual(sig, expectedSig)) {
    throw new Error('Ungültige Signatur im signed_request.');
  }

  return JSON.parse(dataString);
}

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
      scope: THREADS_SCOPES,
      response_type: 'code',
      state: userId,
    });

    return res.redirect(
      `https://www.threads.com/oauth/authorize?${params.toString()}`,
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
            scopes: THREADS_SCOPES,
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

  /**
   * Wird von Meta aufgerufen, wenn ein Nutzer die App-Berechtigung
   * widerruft (z.B. in seinen Threads-Einstellungen). Wir entfernen
   * dann den zugehörigen Datenbank-Eintrag.
   */
  @Post('threads/deauthorize')
  async threadsDeauthorize(
    @Body('signed_request') signedRequest: string,
    @Res() res: Response,
  ) {
    try {
      const data = parseSignedRequest(
        signedRequest,
        process.env.THREADS_CLIENT_SECRET!,
      );
      const platformUserId = String(data.user_id);

      await this.supabase.client
        .from('connected_accounts')
        .delete()
        .eq('platform', 'threads')
        .eq('platform_user_id', platformUserId);

      return res.status(200).send('OK');
    } catch (err) {
      console.error('Threads Deauthorize Fehler:', err);
      return res.status(400).send('Ungültige Anfrage.');
    }
  }

  /**
   * Wird von Meta aufgerufen, wenn ein Nutzer über Facebook/Threads eine
   * Löschung seiner Daten anfragt. Wir löschen den Datenbank-Eintrag und
   * geben Meta eine Status-URL + Bestätigungscode zurück (Pflichtformat).
   */
  @Post('threads/data-deletion')
  async threadsDataDeletion(
    @Body('signed_request') signedRequest: string,
    @Res() res: Response,
  ) {
    try {
      const data = parseSignedRequest(
        signedRequest,
        process.env.THREADS_CLIENT_SECRET!,
      );
      const platformUserId = String(data.user_id);
      const confirmationCode = crypto.randomBytes(8).toString('hex');

      await this.supabase.client
        .from('connected_accounts')
        .delete()
        .eq('platform', 'threads')
        .eq('platform_user_id', platformUserId);

      return res.json({
        url: `https://reachit-backend-production.up.railway.app/connect/threads/deletion-status/${confirmationCode}`,
        confirmation_code: confirmationCode,
      });
    } catch (err) {
      console.error('Threads Data Deletion Fehler:', err);
      return res.status(400).send('Ungültige Anfrage.');
    }
  }

  /**
   * Öffentliche Status-Seite, auf die der Bestätigungscode oben verweist.
   */
  @Get('threads/deletion-status/:code')
  threadsDeletionStatus(@Param('code') code: string, @Res() res: Response) {
    res.type('html').send(`
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>Löschstatus - ReachIT</title></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto;">
  <h1>Löschung abgeschlossen</h1>
  <p>Deine Daten wurden erfolgreich gelöscht.</p>
  <p>Bestätigungscode: <strong>${code}</strong></p>
</body>
</html>
    `);
  }
}
