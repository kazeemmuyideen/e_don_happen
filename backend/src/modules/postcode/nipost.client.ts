import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface NipostLookupResult {
  postcode: string;
  valid: boolean;
  administrative_address?: {
    state_name: string;
    lga_name: string;
    locality_name: string;
    zone: string;
  };
  recent_house_address?: { recent: string };
  building_use_status?: string;
}

export interface NipostAutocompleteSuggestion {
  code: string;
  label: string;
}

export interface NipostAutocompleteResult {
  segment: 'state' | 'lga' | 'district' | 'area' | 'unit';
  suggestions: NipostAutocompleteSuggestion[];
}

export interface NipostReverseResult {
  found: boolean;
  coordinate: [number, number];
  unit?: {
    postcode: string;
    display: string;
    distance_m: number;
    confidence: 'high' | 'medium' | 'low';
    state_name?: string;
    lga_name?: string;
    locality_name?: string;
    address?: string;
  };
  area: string;
  district: string;
  state: string;
  message?: string;
  radius_m: number;
}

export class NipostApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NipostApiError';
  }
}

@Injectable()
export class NipostClient {
  private readonly logger = new Logger(NipostClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.baseUrl = (
      config.get<string>('nipost.baseUrl') ||
      'https://api.postcode.gov.ng'
    ).replace(/\/+$/, '');
    this.apiKey = config.get<string>('nipost.apiKey') || '';
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async lookup(
    code: string,
    level = 1,
  ): Promise<{ data: NipostLookupResult }> {
    return this.request<{ data: NipostLookupResult }>(
      `/v1/lookup?code=${encodeURIComponent(code)}&level=${level}`,
    );
  }

  async autocomplete(
    query: string,
  ): Promise<{ data: NipostAutocompleteResult }> {
    return this.request<{ data: NipostAutocompleteResult }>(
      `/v1/search/autocomplete?q=${encodeURIComponent(query)}`,
    );
  }

  async reverseGeocode(
    latitude: number,
    longitude: number,
    maxDistanceM?: number,
  ): Promise<{ data: NipostReverseResult }> {
    const params = new URLSearchParams({
      lat: String(latitude),
      lng: String(longitude),
    });
    if (maxDistanceM !== undefined)
      params.set('max_distance_m', String(maxDistanceM));
    return this.request<{ data: NipostReverseResult }>(
      `/v1/search/reverse?${params.toString()}`,
    );
  }

  private async request<T>(path: string): Promise<T> {
    if (!this.apiKey)
      throw new ServiceUnavailableException(
        'NIPOST Postcode API is not configured.',
      );

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'X-API-Key': this.apiKey },
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      this.logger.warn(
        `NIPOST API request failed (${path}): ${(error as Error).message}`,
      );
      throw new BadGatewayException('Postcode service is unreachable.');
    }

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const errorCode = (body as any)?.error?.code ?? response.status;
      const message =
        (body as any)?.error?.message ??
        'NIPOST API rejected the postcode request.';
      this.logger.warn(
        `NIPOST API error ${response.status} (${errorCode}) on ${path}: ${message}`,
      );
      throw new NipostApiError(response.status, errorCode, message);
    }

    return body as T;
  }
}
