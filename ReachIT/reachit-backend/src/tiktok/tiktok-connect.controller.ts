import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import axios from 'axios';
import * as crypto from 'crypto';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { RedisService } from '../redis/redis.service.js';
import { describeError } from '../common/describe-error.js';

const TIKTOK_REDIRECT_URI =
  'https://reachit-backend-production.up.railway.app/connect/tiktok/callback';
const TIKTOK_SCOPES = 'user.info.basic,video.publish,video.upload';

const PKCE_TTL_SECONDS = 10 * 60; // 10 Minuten

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
    private readonly redis: RedisService,
  ) {}

  // Schritt 1: Nutzer klickt "TikTok verbinden" -> Redirect zu TikTok
  @Get('tiktok')
  async connectTiktok(@Query('userId') userId: string, @Res() res: Response) {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(16).toString('hex');

    // Verifier + userId in Redis zwischenspeichern (10 Minuten gültig)
    await this.redis.set(
      `tiktok:pkce:${state}`,
      JSON.stringify({ userId, codeVerifier }),
      PKCE_TTL_SECONDS,
    );

    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      response_type: 'code',
      scope: TIKTOK_SCOPES,
      redirect_uri: TIKTOK_REDIRECT_URI,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return res.redirect(
      `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`,
    );
  }

  // Schritt 2: TikTok leitet mit "code" und "state" hierher zurück
  @Get('tiktok/callback')
  async tiktokCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const pendingRaw = await this.redis.get(`tiktok:pkce:${state}`);

    if (!code || !pendingRaw) {
      return res
        .status(400)
        .send('Ungültige oder abgelaufene Anfrage. Bitte erneut versuchen.');
    }

    await this.redis.delete(`tiktok:pkce:${state}`);
    const { userId, codeVerifier } = JSON.parse(pendingRaw) as {
      userId: string;
      codeVerifier: string;
    };

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
