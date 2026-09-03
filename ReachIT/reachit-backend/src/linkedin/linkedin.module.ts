import { Module } from '@nestjs/common';
import { LinkedinConnectController } from './linkedin-connect.controller.js';
import { LinkedinPublishService } from './linkedin-publish.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Module({
  imports: [AuthModule],
  controllers: [LinkedinConnectController],
  providers: [LinkedinPublishService, SupabaseService, EncryptionService],
  exports: [LinkedinPublishService],
})
export class LinkedinModule {}
