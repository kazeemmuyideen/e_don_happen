import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;
  let dataSource: any;

  beforeEach(async () => {
    dataSource = { query: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: DataSource, useValue: dataSource }],
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
});
