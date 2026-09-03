import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { TokensModule } from '../tokens/tokens.module.js';
import { R2Service } from '../storage/r2.service.js';
import { InstagramPublishService } from '../instagram/instagram-publish.service.js';
import { TiktokPublishService } from '../tiktok/tiktok-publish.service.js';
import { ThreadsPublishService } from '../threads/threads-publish.service.js';
import { LinkedinPublishService } from '../linkedin/linkedin-publish.service.js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { PostLogService } from './post-log.service.js';
import { MultiPostService } from './multi-post.service.js';

@Module({
  imports: [AuthModule, TokensModule],
  controllers: [PostsController],
  providers: [
    R2Service,
    InstagramPublishService,
    TiktokPublishService,
    ThreadsPublishService,
    LinkedinPublishService,
    SupabaseService,
    PostLogService,
    MultiPostService,
  ],
})
export class PostsModule {}
