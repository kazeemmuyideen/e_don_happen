import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  PostcodeAutocompleteQueryDto,
  PostcodeLookupQueryDto,
  PostcodeReverseQueryDto,
} from './dto/postcode.dto.js';
import { PostcodeService } from './postcode.service.js';

@ApiTags('postcode')
@Controller('postcode')
export class PostcodeController {
  constructor(private readonly postcodeService: PostcodeService) {}

  @Get('lookup')
  @ApiOperation({
    summary: 'Validate a NIPOST postcode (level 1 is free)',
  })
  @ApiOkResponse({ description: 'Postcode validity and optional details' })
  @ApiBadRequestResponse({ description: 'Malformed postcode query' })
  async lookup(@Query() query: PostcodeLookupQueryDto) {
    return this.postcodeService.lookup(query.code, query.level ?? 1);
  }

  @Get('autocomplete')
  @ApiOperation({ summary: 'Segment-aware postcode type-ahead' })
  @ApiOkResponse({ description: 'Suggestions for the active segment' })
  async autocomplete(@Query() query: PostcodeAutocompleteQueryDto) {
    return this.postcodeService.autocomplete(query.q);
  }

  @Get('reverse')
  @ApiOperation({
    summary: 'Resolve a coordinate to the nearest NIPOST postcode',
  })
  @ApiOkResponse({ description: 'Nearest postcode within the snap radius' })
  async reverse(@Query() query: PostcodeReverseQueryDto) {
    return this.postcodeService.reverseGeocode(
      query.lat,
      query.lng,
      query.maxDistanceM,
    );
  }
}
