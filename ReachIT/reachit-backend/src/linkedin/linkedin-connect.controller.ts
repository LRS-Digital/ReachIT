import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import axios from 'axios';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { describeError } from '../common/describe-error.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OAuthStateService } from '../auth/oauth-state.service.js';

const LINKEDIN_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/linkedin/callback';
const LINKEDIN_SCOPES = 'openid profile w_member_social';

@Controller('connect')
export class LinkedinConnectController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly oauthState: OAuthStateService,
  ) {}

  // Schritt 1: Die App holt sich die Autorisierungs-URL. Das geht nur mit
  // gültigem Supabase-Token, denn hier wird festgelegt, welchem ReachIT-Nutzer
  // das LinkedIn-Konto später zugeordnet wird.
  @Post('linkedin/start')
  @UseGuards(SupabaseAuthGuard)
  async startLinkedin(@CurrentUser() userId: string) {
    const state = await this.oauthState.create('linkedin', userId);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: LINKEDIN_REDIRECT_URI,
      state,
      scope: LINKEDIN_SCOPES,
    });

    return {
      url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
    };
  }

  // Schritt 2: LinkedIn leitet mit "code" hierher zurück
  @Get('linkedin/callback')
  async linkedinCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    // Der State ist ein Einmal-Token aus Redis, keine rohe Nutzer-ID mehr.
    const pending = await this.oauthState.consume('linkedin', state);

    if (!code || !pending) {
      return res
        .status(400)
        .send('Ungültige oder abgelaufene Anfrage. Bitte erneut versuchen.');
    }

    const userId = pending.userId;

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
