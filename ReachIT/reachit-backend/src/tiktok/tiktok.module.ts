import { Module } from '@nestjs/common';
import { TiktokConnectController } from './tiktok-connect.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Module({
  imports: [AuthModule],
  controllers: [TiktokConnectController],
  providers: [SupabaseService, EncryptionService],
})
export class TiktokModule {}
