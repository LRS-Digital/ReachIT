import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Module({
  imports: [AuthModule],
  controllers: [ConnectController],
  providers: [SupabaseService, EncryptionService],
})
export class ConnectModule {}
