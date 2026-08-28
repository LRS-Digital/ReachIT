import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import axios from 'axios';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

const INSTAGRAM_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/instagram/callback';

@Controller('connect')
export class ConnectController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  // Schritt 1: Nutzer klickt "Instagram verbinden" -> Redirect zu Instagram
  @Get('instagram')
  connectInstagram(@Query('userId') userId: string, @Res() res: Response) {
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_CLIENT_ID!,
      redirect_uri: INSTAGRAM_REDIRECT_URI,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_content_publish',
      state: userId, // so wissen wir im Callback, welcher ReachIT-Nutzer das war
    });

    return res.redirect(
      `https://api.instagram.com/oauth/authorize?${params.toString()}`,
    );
  }

  // Schritt 2: Instagram leitet mit einem "code" hierher zurück
  @Get('instagram/callback')
  async instagramCallback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    if (!code) {
      return res.status(400).send('Kein Autorisierungscode erhalten.');
    }

    try {
      // Code gegen kurzlebiges Access Token tauschen
      // WICHTIG: Antwort als Rohtext lesen (nicht automatisch als JSON parsen),
      // da Instagram-IDs 17-stellig sind und JavaScript beim normalen
      // JSON.parse große Zahlen ungenau rundet (Number.MAX_SAFE_INTEGER
      // hat nur 16 Stellen). Per Regex extrahieren wir die exakte Ziffernfolge.
      const tokenResponse = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        new URLSearchParams({
          client_id: process.env.INSTAGRAM_CLIENT_ID!,
          client_secret: process.env.INSTAGRAM_CLIENT_SECRET!,
          grant_type: 'authorization_code',
          redirect_uri: INSTAGRAM_REDIRECT_URI,
          code,
        }),
        {
          responseType: 'text',
          transformResponse: [(data) => data], // verhindert automatisches JSON.parse
        },
      );

      const rawBody: string = tokenResponse.data;
      const accessTokenMatch = rawBody.match(/"access_token"\s*:\s*"([^"]+)"/);
      const userIdMatch = rawBody.match(/"user_id"\s*:\s*"?(\d+)"?/);

      if (!accessTokenMatch || !userIdMatch) {
        throw new Error(
          `Konnte access_token oder user_id nicht aus der Antwort extrahieren: ${rawBody}`,
        );
      }

      const shortLivedToken = accessTokenMatch[1];
      const platformUserId = userIdMatch[1]; // exakte Ziffernfolge als String

      // Kurzlebiges gegen langlebiges Token (60 Tage) tauschen
      const longLivedResponse = await axios.get(
        'https://graph.instagram.com/access_token',
        {
          params: {
            grant_type: 'ig_exchange_token',
            client_secret: process.env.INSTAGRAM_CLIENT_SECRET!,
            access_token: shortLivedToken,
          },
        },
      );

      const { access_token: longLivedToken, expires_in } =
        longLivedResponse.data;

      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Verschlüsselt in Supabase speichern
      const { error } = await this.supabase.client
        .from('connected_accounts')
        .upsert(
          {
            user_id: userId,
            platform: 'instagram',
            platform_user_id: String(platformUserId),
            access_token: this.encryption.encrypt(longLivedToken),
            expires_at: expiresAt.toISOString(),
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,platform,platform_user_id' },
        );

      if (error) throw error;

      return res.send(
        'Instagram-Konto erfolgreich verbunden! Du kannst dieses Fenster schließen.',
      );
    } catch (err) {
      console.error('Instagram OAuth Fehler:', err);
      return res.status(500).send('Verbindung fehlgeschlagen.');
    }
  }
}
