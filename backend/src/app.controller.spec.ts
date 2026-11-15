import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { REDIS_CLIENT } from './redis/redis.module.js';

describe('AppController', () => {
  let appController: AppController;
  let dataSource: any;
  let redis: any;

  beforeEach(async () => {
    dataSource = { query: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redis = { ping: vi.fn().mockResolvedValue('PONG') };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(() => vi.clearAllMocks());

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('reports database connectivity', async () => {
      const result = await appController.health();

      expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
      expect(result.status).toBe('ok');
      expect(result.database).toBe('up');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('returns 503 when the database is unreachable', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));

      await expect(appController.health()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });

  describe('ready', () => {
    it('reports database and Redis connectivity', async () => {
      const result = await appController.ready();
      expect(result.status).toBe('ok');
      expect(result.redis).toBe('up');
      expect(redis.ping).toHaveBeenCalled();
    });

    it('returns 503 when Redis is unreachable', async () => {
      redis.ping.mockRejectedValue(new Error('redis down'));
      await expect(appController.ready()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
