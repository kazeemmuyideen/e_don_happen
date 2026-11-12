import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NipostClient,
  NipostApiError,
  type NipostAutocompleteResult,
  type NipostLookupResult,
  type NipostReverseResult,
} from './nipost.client.js';
import { normalizePostcode, formatPostcodeDisplay } from './utils/postcode.js';

export interface PostcodeValidation {
  postcode: string;
  display: string;
  valid: boolean;
  /** 'nipost' when confirmed against the NIPOST API, 'format' when offline only */
  source: 'nipost' | 'format';
  lookup?: NipostLookupResult;
}

export interface PostcodeAreaDetails {
  stateName?: string;
  lgaName?: string;
  localityName?: string;
  zone?: string;
  address?: string;
}

@Injectable()
export class PostcodeService {
  private readonly logger = new Logger(PostcodeService.name);
  private readonly lookupLevel: number;

  constructor(
    private readonly client: NipostClient,
    config: ConfigService,
  ) {
    this.lookupLevel = Math.min(
      Math.max(config.get<number>('nipost.lookupLevel') ?? 1, 1),
      5,
    );
  }

  get configured(): boolean {
    return this.client.configured;
  }

  /**
   * Validates a postcode. Format is always checked offline; when the
   * NIPOST API is configured the code is also confirmed against the
   * gateway (level 1 is free). NIPOST outages degrade to format-only
   * validation rather than rejecting reports.
   */
  async lookup(code: string, level = 1): Promise<PostcodeValidation> {
    const compact = normalizePostcode(code);
    const { data } = await this.client.lookup(compact, level);
    return {
      postcode: data.postcode ?? compact,
      display: formatPostcodeDisplay(compact),
      valid: data.valid !== false,
      source: 'nipost',
      lookup: data,
    };
  }

  async autocomplete(query: string): Promise<NipostAutocompleteResult> {
    const trimmed = query.trim();
    if (!trimmed)
      throw new BadRequestException('Autocomplete query is required.');
    const { data } = await this.client.autocomplete(trimmed);
    return data;
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
    maxDistanceM?: number,
  ): Promise<NipostReverseResult> {
    const { data } = await this.client.reverseGeocode(
      latitude,
      longitude,
      maxDistanceM,
    );
    return data;
  }

  /**
   * Validates a postcode for report submission with a single gateway
   * call at the configured lookup level. Returns area details when the
   * key is granted address-level access (level 2+). NIPOST outages
   * degrade to format-only validation rather than rejecting reports.
   */
  async validateForReport(
    postcode: string,
  ): Promise<PostcodeValidation & { area: PostcodeAreaDetails | null }> {
    const compact = normalizePostcode(postcode);
    const display = formatPostcodeDisplay(compact);

    if (!this.client.configured) {
      return {
        postcode: compact,
        display,
        valid: true,
        source: 'format',
        area: null,
      };
    }

    let data: NipostLookupResult;
    try {
      ({ data } = await this.client.lookup(compact, this.lookupLevel));
    } catch (error) {
      if (error instanceof NipostApiError && error.statusCode === 401) {
        throw new BadRequestException(
          'Postcode service rejected our credentials.',
        );
      }
      this.logger.warn(
        `Postcode validation fell back to format-only check: ${(error as Error).message}`,
      );
      return {
        postcode: compact,
        display,
        valid: true,
        source: 'format',
        area: null,
      };
    }

    if (data.valid === false) {
      throw new BadRequestException(
        `Postcode ${display} is not assigned to any building.`,
      );
    }

    const address = data.administrative_address;
    return {
      postcode: compact,
      display,
      valid: true,
      source: 'nipost',
      lookup: data,
      area: address
        ? {
            stateName: address.state_name,
            lgaName: address.lga_name,
            localityName: address.locality_name,
            zone: address.zone,
            address: data.recent_house_address?.recent,
          }
        : null,
    };
  }
}
