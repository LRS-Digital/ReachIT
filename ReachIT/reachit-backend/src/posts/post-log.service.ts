import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

export type PostStatus = 'success' | 'failed';
export type MediaType = 'text' | 'image' | 'video';
export type Platform =
  'instagram' | 'tiktok' | 'threads' | 'linkedin' | 'pinterest';

interface PostAnlegenParams {
  userId: string;
  caption: string;
  mediaType: MediaType;
  fileSizeBytes?: number;
  mimeType?: string;
}

interface ZielProtokollParams {
  platform: Platform;
  status: PostStatus;
  connectedAccountId?: string;
  externalId?: string;
  errorMessage?: string;
  durationMs?: number;
  verified?: boolean;
  postUrl?: string;
}

interface LogAttemptParams extends PostAnlegenParams, ZielProtokollParams {}

@Injectable()
export class PostLogService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Legt den posts-Eintrag an und gibt seine ID zurück.
   *
   * Der Status startet auf 'publishing' und wird nach Abschluss über
   * `setzePostStatus` festgeschrieben. Beim Posten auf mehrere Plattformen
   * steht das Gesamtergebnis erst fest, wenn alle Ziele durch sind.
   */
  async legePostAn(params: PostAnlegenParams): Promise<string | null> {
    const { data, error } = await this.supabase.client
      .from('posts')
      .insert({
        user_id: params.userId,
        caption: params.caption,
        media_type: params.mediaType,
        status: 'publishing',
        file_size_bytes: params.fileSizeBytes ?? null,
        mime_type: params.mimeType ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      // Logging darf niemals den eigentlichen Post-Vorgang zum Absturz bringen
      console.error('Post-Log Fehler (posts):', error);
      return null;
    }

    return data.id as string;
  }

  /**
   * Protokolliert das Ergebnis für genau eine Plattform.
   */
  async protokolliereZiel(
    postId: string | null,
    params: ZielProtokollParams,
  ): Promise<void> {
    if (!postId) return;

    const { error } = await this.supabase.client.from('post_targets').insert({
      post_id: postId,
      connected_account_id: params.connectedAccountId ?? null,
      platform: params.platform,
      status: params.status,
      external_id: params.externalId ?? null,
      error_message: params.errorMessage ?? null,
      duration_ms: params.durationMs ?? null,
      verified: params.verified ?? false,
      post_url: params.postUrl ?? null,
      published_at:
        params.status === 'success' ? new Date().toISOString() : null,
    });

    if (error) {
      console.error('Post-Log Fehler (post_targets):', error);
    }
  }

  /**
   * Schreibt das Gesamtergebnis fest. 'done', sobald mindestens eine Plattform
   * erfolgreich war - ein Teilerfolg ist kein gescheiterter Post. Das Detail
   * pro Plattform steht in post_targets.
   */
  async setzePostStatus(
    postId: string | null,
    mindestensEinErfolg: boolean,
  ): Promise<void> {
    if (!postId) return;

    const { error } = await this.supabase.client
      .from('posts')
      .update({ status: mindestensEinErfolg ? 'done' : 'failed' })
      .eq('id', postId);

    if (error) {
      console.error('Post-Log Fehler (posts.status):', error);
    }
  }

  /**
   * Protokolliert einen Post-Versuch auf genau einer Plattform: ein
   * posts-Eintrag mit einem post_targets-Eintrag.
   *
   * Wird von den Einzel-Endpunkten genutzt. Der zentrale Multi-Plattform-
   * Endpunkt setzt stattdessen die drei Methoden oben zusammen, weil dort
   * mehrere Ziele zu einem posts-Eintrag gehören.
   */
  async logAttempt(params: LogAttemptParams): Promise<void> {
    const postId = await this.legePostAn(params);
    if (!postId) return;

    await this.protokolliereZiel(postId, params);
    await this.setzePostStatus(postId, params.status === 'success');
  }
}
