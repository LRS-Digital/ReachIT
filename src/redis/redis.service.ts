import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST!,
      port: Number(process.env.REDIS_PORT),
      password: process.env.REDIS_PASSWORD!,
      tls: {}, // Upstash erfordert TLS-Verbindungen
    });
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
