import { Module } from '@nestjs/common';
import { TokenRefreshService } from './token-refresh.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { RedisService } from '../redis/redis.service.js';

@Module({
  providers: [
    TokenRefreshService,
    SupabaseService,
    EncryptionService,
    RedisService,
  ],
  exports: [TokenRefreshService],
})
export class TokensModule {}
