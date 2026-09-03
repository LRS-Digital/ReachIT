import { Module } from '@nestjs/common';
import { ThreadsConnectController } from './threads-connect.controller.js';
import { ThreadsPublishService } from './threads-publish.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ThreadsConnectController],
  providers: [ThreadsPublishService, SupabaseService, EncryptionService],
  exports: [ThreadsPublishService],
})
export class ThreadsModule {}
