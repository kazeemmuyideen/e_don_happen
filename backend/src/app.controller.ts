import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { AppService } from './app.service.js';
import { REDIS_CLIENT } from './redis/redis.module.js';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly db: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async health() {
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 'ok',
      database: 'up',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    let database = 'up';
    let redis = 'up';
    try {
      await this.db.query('SELECT 1');
    } catch {
      database = 'down';
    }
    try {
      await this.redis.ping();
    } catch {
      redis = 'down';
    }
    if (database === 'down' || redis === 'down') {
      throw new ServiceUnavailableException({
        status: 'error',
        database,
        redis,
        timestamp: new Date().toISOString(),
      });
    }
    return {
      status: 'ok',
      database,
      redis,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
