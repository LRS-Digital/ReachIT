import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service.js';

export type PostStatus = 'success' | 'failed';
export type MediaType = 'text' | 'image' | 'video';
export type Platform =
  | 'instagram'
  | 'tiktok'
  | 'threads'
  | 'linkedin'
  | 'pinterest';

interface LogAttemptParams {
  userId: string;
  caption: string;
  mediaType: MediaType;
  platform: Platform;
  status: PostStatus;
  connectedAccountId?: string;
  externalId?: string;
  errorMessage?: string;
  fileSizeBytes?: number;
  mimeType?: string;
  durationMs?: number;
  verified?: boolean;
  postUrl?: string;
}

@Injectable()
export class PostLogService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Protokolliert jeden Post-Versuch (egal ob erfolgreich oder fehlgeschlagen)
   * für die interne Auswertung: welche Plattformen genutzt werden, wo Fehler
   * gehäuft auftreten, wie lange Posts pro Plattform brauchen, und ob
   * Dateigröße/-typ mit Fehlern korrelieren.
   */
  async logAttempt(params: LogAttemptParams): Promise<void> {
    const {
      userId,
      caption,
      mediaType,
      platform,
      status,
      connectedAccountId,
      externalId,
      errorMessage,
      fileSizeBytes,
      mimeType,
      durationMs,
      verified,
      postUrl,
    } = params;

    const { data: post, error: postError } = await this.supabase.client
      .from('posts')
      .insert({
        user_id: userId,
        caption,
        media_type: mediaType,
        status: status === 'success' ? 'done' : 'failed',
        file_size_bytes: fileSizeBytes ?? null,
        mime_type: mimeType ?? null,
      })
      .select()
      .single();

    if (postError || !post) {
      // Logging darf niemals den eigentlichen Post-Vorgang zum Absturz bringen
      console.error('Post-Log Fehler (posts):', postError);
      return;
    }

    const { error: targetError } = await this.supabase.client
      .from('post_targets')
      .insert({
        post_id: post.id,
        connected_account_id: connectedAccountId ?? null,
        platform,
        status,
        external_id: externalId ?? null,
        error_message: errorMessage ?? null,
        duration_ms: durationMs ?? null,
        verified: verified ?? false,
        post_url: postUrl ?? null,
        published_at: status === 'success' ? new Date().toISOString() : null,
      });

    if (targetError) {
      console.error('Post-Log Fehler (post_targets):', targetError);
    }
  }
}
