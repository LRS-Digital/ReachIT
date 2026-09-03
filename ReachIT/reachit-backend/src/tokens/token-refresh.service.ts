import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { RedisService } from '../redis/redis.service.js';
import { describeError } from '../common/describe-error.js';

export interface ConnectedAccount {
  id: string;
  platform: string;
  platform_user_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

/**
 * Wie lange vor Ablauf erneuert wird. Eine gemeinsame Schwelle passt nicht:
 * TikToks Access-Token gilt 24 Stunden, Instagram und Threads geben 60 Tage.
 */
const ERNEUERN_AB_MS: Record<string, number> = {
  instagram: 7 * 24 * 60 * 60 * 1000,
  threads: 7 * 24 * 60 * 60 * 1000,
  tiktok: 60 * 60 * 1000,
};

const SPERRE_TTL_SECONDS = 30;
const SPERRE_WARTEN_MS = 500;
const SPERRE_VERSUCHE = 10;

/**
 * Hält die Plattform-Tokens gültig.
 *
 * Ohne diesen Dienst laufen sie einfach ab: TikTok nach 24 Stunden, Instagram
 * und Threads nach 60 Tagen. Der Post scheitert dann mit einer
 * Plattform-Fehlermeldung, die nicht nach einem Token-Problem aussieht.
 *
 * LinkedIn fehlt hier bewusst: Programmatic Refresh Tokens gibt LinkedIn nur
 * für freigegebene Apps aus. Ohne diese Freigabe bleibt nur neu verbinden,
 * deshalb wird dort eine klare Meldung geworfen statt still zu scheitern.
 */
@Injectable()
export class TokenRefreshService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Liefert einen gültigen Access-Token und erneuert ihn unterwegs, falls er
   * bald abläuft.
   */
  async ensureFresh(account: ConnectedAccount): Promise<string> {
    if (!this.brauchtErneuerung(account)) {
      return this.encryption.decrypt(account.access_token);
    }

    const sperrschluessel = `token:refresh:${account.id}`;
    const sperreErhalten = await this.redis.setIfAbsent(
      sperrschluessel,
      '1',
      SPERRE_TTL_SECONDS,
    );

    // TikTok rotiert den Refresh-Token bei jeder Erneuerung mit. Zwei
    // gleichzeitige Erneuerungen würden sich gegenseitig entwerten - das
    // passiert spätestens beim parallelen Posten auf mehrere Plattformen.
    if (!sperreErhalten) {
      return this.warteAufFremdeErneuerung(account, sperrschluessel);
    }

    try {
      return await this.erneuern(account);
    } finally {
      await this.redis.delete(sperrschluessel);
    }
  }

  private brauchtErneuerung(account: ConnectedAccount): boolean {
    if (!account.expires_at) return false;

    const schwelle = ERNEUERN_AB_MS[account.platform];
    if (schwelle === undefined) return this.istAbgelaufen(account);

    return new Date(account.expires_at).getTime() - Date.now() < schwelle;
  }

  private istAbgelaufen(account: ConnectedAccount): boolean {
    if (!account.expires_at) return false;
    return new Date(account.expires_at).getTime() <= Date.now();
  }

  private async erneuern(account: ConnectedAccount): Promise<string> {
    switch (account.platform) {
      case 'instagram':
        return this.erneuereMeta(
          account,
          'https://graph.instagram.com/refresh_access_token',
          'ig_refresh_token',
        );
      case 'threads':
        return this.erneuereMeta(
          account,
          'https://graph.threads.net/refresh_access_token',
          'th_refresh_token',
        );
      case 'tiktok':
        return this.erneuereTiktok(account);
      default:
        throw new Error(
          `Die ${account.platform}-Verbindung ist abgelaufen und lässt sich nicht automatisch erneuern. Bitte neu verbinden.`,
        );
    }
  }

  /**
   * Instagram und Threads tauschen den Long-Lived-Token gegen einen neuen mit
   * wieder 60 Tagen. Beide erneuern nur noch gültige Tokens - ein bereits
   * abgelaufener ist verloren.
   */
  private async erneuereMeta(
    account: ConnectedAccount,
    url: string,
    grantType: string,
  ): Promise<string> {
    if (this.istAbgelaufen(account)) {
      throw new Error(
        `Die ${account.platform}-Verbindung ist abgelaufen und muss neu hergestellt werden.`,
      );
    }

    const aktuellerToken = this.encryption.decrypt(account.access_token);

    try {
      const { data } = await axios.get(url, {
        params: { grant_type: grantType, access_token: aktuellerToken },
      });

      return this.speichern(account, data.access_token, data.expires_in, null);
    } catch (err) {
      console.error(
        `Token-Erneuerung (${account.platform}) fehlgeschlagen:`,
        describeError(err),
      );
      throw new Error(
        `Die ${account.platform}-Verbindung konnte nicht erneuert werden. Bitte neu verbinden.`,
      );
    }
  }

  /**
   * TikToks Access-Token gilt nur 24 Stunden, der Refresh-Token dafür 365
   * Tage. Ein abgelaufener Access-Token ist hier also kein Problem.
   */
  private async erneuereTiktok(account: ConnectedAccount): Promise<string> {
    if (!account.refresh_token) {
      throw new Error(
        'Für die TikTok-Verbindung ist kein Refresh-Token gespeichert. Bitte neu verbinden.',
      );
    }

    const refreshToken = this.encryption.decrypt(account.refresh_token);

    try {
      const { data } = await axios.post(
        'https://open.tiktokapis.com/v2/oauth/token/',
        new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      // Der neue Refresh-Token muss mitgespeichert werden, sonst läuft die
      // Verbindung nach 365 Tagen unwiederbringlich aus.
      return this.speichern(
        account,
        data.access_token,
        data.expires_in,
        data.refresh_token ?? null,
      );
    } catch (err) {
      console.error(
        'Token-Erneuerung (tiktok) fehlgeschlagen:',
        describeError(err),
      );
      throw new Error(
        'Die TikTok-Verbindung konnte nicht erneuert werden. Bitte neu verbinden.',
      );
    }
  }

  private async speichern(
    account: ConnectedAccount,
    accessToken: string,
    expiresIn: number,
    refreshToken: string | null,
  ): Promise<string> {
    const update: Record<string, string> = {
      access_token: this.encryption.encrypt(accessToken),
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };

    if (refreshToken) {
      update.refresh_token = this.encryption.encrypt(refreshToken);
    }

    const { error } = await this.supabase.client
      .from('connected_accounts')
      .update(update)
      .eq('id', account.id);

    if (error) throw error;

    return accessToken;
  }

  /**
   * Ein paralleler Aufruf erneuert gerade. Warten, bis dessen Sperre fällt,
   * und den frisch gespeicherten Token aus der Datenbank lesen.
   */
  private async warteAufFremdeErneuerung(
    account: ConnectedAccount,
    sperrschluessel: string,
  ): Promise<string> {
    for (let versuch = 0; versuch < SPERRE_VERSUCHE; versuch++) {
      await new Promise((fertig) => setTimeout(fertig, SPERRE_WARTEN_MS));

      if (!(await this.redis.exists(sperrschluessel))) break;
    }

    const { data, error } = await this.supabase.client
      .from('connected_accounts')
      .select('access_token')
      .eq('id', account.id)
      .single();

    if (error || !data) {
      throw new Error(
        `Die ${account.platform}-Verbindung wird gerade erneuert. Bitte kurz warten und erneut versuchen.`,
      );
    }

    return this.encryption.decrypt(data.access_token);
  }
}
