import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConnectModule } from './connect/connect.module.js';

@Module({
  imports: [ConnectModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
