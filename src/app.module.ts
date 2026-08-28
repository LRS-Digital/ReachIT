import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConnectModule } from './connect/connect.module.js';
import { PostsModule } from './posts/posts.module.js';
import { LegalModule } from './legal/legal.module.js';
import { TiktokModule } from './tiktok/tiktok.module.js';
import { ThreadsModule } from './threads/threads.module.js';

@Module({
  imports: [ConnectModule, PostsModule, LegalModule, TiktokModule, ThreadsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
