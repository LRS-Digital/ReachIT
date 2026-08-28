import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller.js';
import { R2Service } from '../storage/r2.service.js';
import { InstagramPublishService } from '../instagram/instagram-publish.service.js';
import { TiktokPublishService } from '../tiktok/tiktok-publish.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { EncryptionService } from '../crypto/encryption.service.js';

@Module({
  controllers: [PostsController],
  providers: [
    R2Service,
    InstagramPublishService,
    TiktokPublishService,
    SupabaseService,
    EncryptionService,
  ],
})
export class PostsModule {}
