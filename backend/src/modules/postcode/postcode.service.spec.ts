import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostcodeService } from './postcode.service.js';
import { NipostClient, NipostApiError } from './nipost.client.js';
import { normalizePostcode, formatPostcodeDisplay } from './utils/postcode.js';

describe('PostcodeService', () => {
  let service: PostcodeService;
  let client: any;

  const mockAddress = {
    state_name: 'EKITI',
    lga_name: 'ADO EKITI',
    locality_name: 'ADO EKITI',
    zone: 'SOUTH WEST',
  };

  beforeEach(async () => {
    client = {
      configured: true,
      lookup: vi.fn(),
      autocomplete: vi.fn(),
      reverseGeocode: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostcodeService,
        { provide: NipostClient, useValue: client },
        { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(1) } },
      ],
    }).compile();

    service = module.get<PostcodeService>(PostcodeService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizePostcode (unit)', () => {
    it('accepts separators and mixed case, returning compact form', () => {
      expect(normalizePostcode('ek 01 a03 fk 01')).toBe('EK01A03FK01');
      expect(normalizePostcode('FC-02-A09-DB-09')).toBe('FC02A09DB09');
      expect(normalizePostcode('ek01a03fk01')).toBe('EK01A03FK01');
    });

    it('rejects malformed postcodes', () => {
      expect(() => normalizePostcode('123456')).toThrow(BadRequestException);
      expect(() => normalizePostcode('EK-01-A03')).toThrow(BadRequestException);
      expect(() => normalizePostcode('EK011A03FK01')).toThrow(
        BadRequestException,
      );
      expect(() => normalizePostcode('')).toThrow(BadRequestException);
    });

    it('formats a compact code for display', () => {
      expect(formatPostcodeDisplay('EK01A03FK01')).toBe('EK 01 A03 FK 01');
    });
  });

  describe('validateForReport', () => {
    it('falls back to format-only validation when the API is not configured', async () => {
      client.configured = false;

      const result = await service.validateForReport('ek 01 a03 fk 01');

      expect(result.valid).toBe(true);
      expect(result.source).toBe('format');
      expect(result.postcode).toBe('EK01A03FK01');
      expect(result.area).toBeNull();
      expect(client.lookup).not.toHaveBeenCalled();
    });

    it('returns area details from a successful NIPOST lookup', async () => {
      client.lookup.mockResolvedValue({
        data: {
          postcode: 'EK-01-A03-FK-01',
          valid: true,
          administrative_address: mockAddress,
          recent_house_address: { recent: 'NTA ROAD, ADO EKITI' },
        },
      });

      const result = await service.validateForReport('EK-01-A03-FK-01');

      expect(client.lookup).toHaveBeenCalledWith('EK01A03FK01', 1);
      expect(result.valid).toBe(true);
      expect(result.source).toBe('nipost');
      expect(result.area?.localityName).toBe('ADO EKITI');
      expect(result.area?.stateName).toBe('EKITI');
    });

    it('rejects postcodes the gateway reports as unassigned', async () => {
      client.lookup.mockResolvedValue({
        data: { postcode: 'EK-01-A03-FK-01', valid: false },
      });

      await expect(
        service.validateForReport('EK-01-A03-FK-01'),
      ).rejects.toThrow(BadRequestException);
    });

    it('degrades to format-only validation when NIPOST is unreachable', async () => {
      client.lookup.mockRejectedValue(
        new NipostApiError(503, 'upstream_error', 'gateway down'),
      );

      const result = await service.validateForReport('EK-01-A03-FK-01');

      expect(result.valid).toBe(true);
      expect(result.source).toBe('format');
      expect(result.area).toBeNull();
    });

    it('rejects when the API key is rejected', async () => {
      client.lookup.mockRejectedValue(
        new NipostApiError(401, 'auth_required', 'invalid key'),
      );

      await expect(
        service.validateForReport('EK-01-A03-FK-01'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects malformed postcodes before calling the API', async () => {
      await expect(service.validateForReport('not-a-code')).rejects.toThrow(
        BadRequestException,
      );
      expect(client.lookup).not.toHaveBeenCalled();
    });
  });

  describe('lookup', () => {
    it('normalizes the code and returns the graded lookup', async () => {
      client.lookup.mockResolvedValue({
        data: { postcode: 'EK-01-A03-FK-01', valid: true },
      });

      const result = await service.lookup('ek01a03fk01', 1);

      expect(client.lookup).toHaveBeenCalledWith('EK01A03FK01', 1);
      expect(result.valid).toBe(true);
      expect(result.source).toBe('nipost');
    });
  });

  describe('autocomplete', () => {
    it('rejects an empty query', async () => {
      await expect(service.autocomplete('   ')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns suggestions from the gateway', async () => {
      client.autocomplete.mockResolvedValue({
        data: {
          segment: 'state',
          suggestions: [{ code: 'EK', label: 'EKITI' }],
        },
      });

      const result = await service.autocomplete('EK');

      expect(client.autocomplete).toHaveBeenCalledWith('EK');
      expect(result.suggestions).toEqual([{ code: 'EK', label: 'EKITI' }]);
    });
  });

  describe('reverseGeocode', () => {
    it('resolves coordinates through the gateway', async () => {
      client.reverseGeocode.mockResolvedValue({
        data: {
          found: true,
          unit: { postcode: 'EK-01-A03-FK-01', confidence: 'high' },
        },
      });

      const result = await service.reverseGeocode(7.62, 5.22, 50);

      expect(client.reverseGeocode).toHaveBeenCalledWith(7.62, 5.22, 50);
      expect(result.found).toBe(true);
    });
  });
});
