import { Module } from '@nestjs/common';
import { TiktokConnectController } from './tiktok-connect.controller.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';
import { RedisService } from '../redis/redis.service.js';

@Module({
  controllers: [TiktokConnectController],
  providers: [SupabaseService, EncryptionService, RedisService],
})
export class TiktokModule {}
