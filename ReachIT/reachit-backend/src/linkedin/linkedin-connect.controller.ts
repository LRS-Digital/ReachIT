import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import axios from 'axios';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { describeError } from '../common/describe-error.js';

const LINKEDIN_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/linkedin/callback';
const LINKEDIN_SCOPES = 'openid profile w_member_social';

@Controller('connect')
export class LinkedinConnectController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
  ) {}

  // Schritt 1: Nutzer klickt "LinkedIn verbinden" -> Redirect zu LinkedIn
  @Get('linkedin')
  connectLinkedin(@Query('userId') userId: string, @Res() res: Response) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: LINKEDIN_REDIRECT_URI,
      state: userId,
      scope: LINKEDIN_SCOPES,
    });

    return res.redirect(
      `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
    );
  }

  // Schritt 2: LinkedIn leitet mit "code" hierher zurück
  @Get('linkedin/callback')
  async linkedinCallback(
    @Query('code') code: string,
    @Query('state') userId: string,
    @Res() res: Response,
  ) {
    if (!code) {
      return res.status(400).send('Kein Autorisierungscode erhalten.');
    }

    try {
      // Code gegen Access Token tauschen
      const tokenResponse = await axios.post(
        'https://www.linkedin.com/oauth/v2/accessToken',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: LINKEDIN_REDIRECT_URI,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );

      const { access_token: accessToken, expires_in: expiresIn } =
        tokenResponse.data;

      // Person-URN über /userinfo holen (OpenID Connect Standard-Endpunkt)
      const userInfoResponse = await axios.get(
        'https://api.linkedin.com/v2/userinfo',
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      const platformUserId = String(userInfoResponse.data.sub);
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const { error } = await this.supabase.client
        .from('connected_accounts')
        .upsert(
          {
            user_id: userId,
            platform: 'linkedin',
            platform_user_id: platformUserId,
            access_token: this.encryption.encrypt(accessToken),
            scopes: LINKEDIN_SCOPES,
            expires_at: expiresAt.toISOString(),
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,platform,platform_user_id' },
        );

      if (error) throw error;

      return res.send(
        'LinkedIn-Konto erfolgreich verbunden! Du kannst dieses Fenster schließen.',
      );
    } catch (err) {
      console.error('LinkedIn OAuth Fehler:', describeError(err));
      return res.status(500).send('Verbindung fehlgeschlagen.');
    }
  }
}
