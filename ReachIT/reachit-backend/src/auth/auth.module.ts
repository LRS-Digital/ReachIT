import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { OAuthStateService } from './oauth-state.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { RedisService } from '../redis/redis.service.js';

@Module({
  providers: [
    SupabaseService,
    RedisService,
    SupabaseAuthGuard,
    OAuthStateService,
  ],
  exports: [SupabaseAuthGuard, OAuthStateService],
})
export class AuthModule {}
