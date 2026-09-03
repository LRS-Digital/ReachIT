import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '../redis/redis.service.js';

const STATE_TTL_SECONDS = 600; // 10 Minuten, wie beim TikTok-PKCE-Verifier

/**
 * Verwaltet den OAuth-`state` für die Verbinden-Strecken.
 *
 * Hintergrund: Die Plattformen leiten den Nutzer im Browser zurück, dort lässt
 * sich kein Authorization-Header setzen. Früher stand deshalb die rohe
 * Nutzer-ID im `state` - wer eine fremde UUID kannte, konnte damit ein
 * Plattform-Konto an einen fremden ReachIT-Nutzer hängen.
 *
 * Jetzt ist `state` ein zufälliges Einmal-Token. Die Zuordnung zur Nutzer-ID
 * liegt in Redis und wird beim Callback verbraucht: Wer den Callback ohne
 * gültigen, noch nicht eingelösten State aufruft, kommt nicht durch.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly redis: RedisService) {}

  async create(
    platform: string,
    userId: string,
    extra: Record<string, string> = {},
  ): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');

    await this.redis.set(
      this.key(platform, state),
      JSON.stringify({ userId, ...extra }),
      STATE_TTL_SECONDS,
    );

    return state;
  }

  /**
   * Löst den State ein. Gibt null zurück, wenn er unbekannt, abgelaufen oder
   * bereits verbraucht ist. Ein State ist bewusst nur einmal gültig.
   */
  async consume(
    platform: string,
    state: string,
  ): Promise<({ userId: string } & Record<string, string>) | null> {
    if (!state) return null;

    const key = this.key(platform, state);
    const raw = await this.redis.get(key);

    if (!raw) return null;

    await this.redis.delete(key);

    return JSON.parse(raw) as { userId: string } & Record<string, string>;
  }

  private key(platform: string, state: string): string {
    return `oauth:state:${platform}:${state}`;
  }
}
