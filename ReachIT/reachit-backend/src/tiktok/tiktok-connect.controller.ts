import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import axios from 'axios';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { describeError } from '../common/describe-error.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { OAuthStateService } from '../auth/oauth-state.service.js';

const TIKTOK_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/tiktok/callback';
const TIKTOK_SCOPES = 'user.info.basic,video.publish,video.upload';

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

@Controller('connect')
export class TiktokConnectController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly oauthState: OAuthStateService,
  ) {}

  // Schritt 1: Die App holt sich die Autorisierungs-URL. Das geht nur mit
  // gültigem Supabase-Token, denn hier wird festgelegt, welchem ReachIT-Nutzer
  // das TikTok-Konto später zugeordnet wird.
  @Post('tiktok/start')
  @UseGuards(SupabaseAuthGuard)
  async startTiktok(@CurrentUser() userId: string) {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // Der PKCE-Verifier reist zusammen mit der Nutzer-ID im State-Eintrag.
    const state = await this.oauthState.create('tiktok', userId, {
      codeVerifier,
    });

    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      response_type: 'code',
      scope: TIKTOK_SCOPES,
      redirect_uri: TIKTOK_REDIRECT_URI,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`,
    };
  }

  // Schritt 2: TikTok leitet mit "code" und "state" hierher zurück
  @Get('tiktok/callback')
  async tiktokCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    // Der State ist ein Einmal-Token aus Redis und trägt den PKCE-Verifier.
    const pending = await this.oauthState.consume('tiktok', state);

    if (!code || !pending) {
      return res
        .status(400)
        .send('Ungültige oder abgelaufene Anfrage. Bitte erneut versuchen.');
    }

    const { userId, codeVerifier } = pending;

    try {
      const tokenResponse = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          code,
          grant_type: 'authorization_code',
          redirect_uri: TIKTOK_REDIRECT_URI,
          code_verifier: codeVerifier,
        }),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );

      const {
        access_token: accessToken,
        refresh_token: refreshToken,
        open_id: openId,
        expires_in: expiresIn,
      } = tokenResponse.data;

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      const { error } = await this.supabase.client
        .from('connected_accounts')
        .upsert(
          {
            user_id: userId,
            platform: 'tiktok',
            platform_user_id: String(openId),
            access_token: this.encryption.encrypt(accessToken),
            refresh_token: this.encryption.encrypt(refreshToken),
            scopes: TIKTOK_SCOPES,
            expires_at: expiresAt.toISOString(),
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,platform,platform_user_id' },
        );

      if (error) throw error;

      return res.send(
        'TikTok-Konto erfolgreich verbunden! Du kannst dieses Fenster schließen.',
      );
    } catch (err) {
      console.error('TikTok OAuth Fehler:', describeError(err));
      return res.status(500).send('Verbindung fehlgeschlagen.');
    }
  }
}
