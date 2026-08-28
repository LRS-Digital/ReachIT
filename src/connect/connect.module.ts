import { Module } from '@nestjs/common';
import { ConnectController } from './connect.controller.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Module({
  controllers: [ConnectController],
  providers: [SupabaseService, EncryptionService],
})
export class ConnectModule {}
