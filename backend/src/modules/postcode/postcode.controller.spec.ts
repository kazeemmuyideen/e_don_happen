import { Test, TestingModule } from '@nestjs/testing';
import { PostcodeController } from './postcode.controller.js';
import { PostcodeService } from './postcode.service.js';

describe('PostcodeController', () => {
  let controller: PostcodeController;
  let service: any;

  beforeEach(async () => {
    service = {
      lookup: vi.fn(),
      autocomplete: vi.fn(),
      reverseGeocode: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostcodeController],
      providers: [{ provide: PostcodeService, useValue: service }],
    }).compile();

    controller = module.get<PostcodeController>(PostcodeController);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('lookup', () => {
    it('delegates to the service with code and level', async () => {
      const expected = {
        postcode: 'EK01A03FK01',
        valid: true,
        source: 'nipost',
      };
      service.lookup.mockResolvedValue(expected);

      const result = await controller.lookup({
        code: 'EK-01-A03-FK-01',
        level: 1,
      });

      expect(service.lookup).toHaveBeenCalledWith('EK-01-A03-FK-01', 1);
      expect(result).toBe(expected);
    });

    it('defaults to level 1 when not provided', async () => {
      service.lookup.mockResolvedValue({ valid: true });

      await controller.lookup({ code: 'EK-01-A03-FK-01' });

      expect(service.lookup).toHaveBeenCalledWith('EK-01-A03-FK-01', 1);
    });
  });

  describe('autocomplete', () => {
    it('delegates to the service with the query', async () => {
      const expected = {
        segment: 'state',
        suggestions: [{ code: 'EK', label: 'EKITI' }],
      };
      service.autocomplete.mockResolvedValue(expected);

      const result = await controller.autocomplete({ q: 'EK' });

      expect(service.autocomplete).toHaveBeenCalledWith('EK');
      expect(result).toBe(expected);
    });
  });

  describe('reverse', () => {
    it('delegates to the service with coordinates and radius', async () => {
      const expected = { found: false, radius_m: 25 };
      service.reverseGeocode.mockResolvedValue(expected);

      const result = await controller.reverse({
        lat: 7.62,
        lng: 5.22,
        maxDistanceM: 100,
      });

      expect(service.reverseGeocode).toHaveBeenCalledWith(7.62, 5.22, 100);
      expect(result).toBe(expected);
    });
  });
});
