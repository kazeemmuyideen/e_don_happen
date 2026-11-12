import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { EvidenceService } from '../services/evidence.service.js';
import {
  ModerateEvidenceDto,
  UploadEvidenceDto,
} from '../dto/evidence.dto.js';

@ApiTags('Evidence')
@ApiBearerAuth()
@Controller()
@UseGuards(AuthGuard('jwt'))
export class EvidenceController {
  constructor(private readonly evidenceService: EvidenceService) {}

  @Post('reports/:reportId/evidence')
  @ApiOperation({ summary: 'Upload image evidence for a report (base64)' })
  upload(
    @Request() req: any,
    @Param('reportId', ParseUUIDPipe) reportId: string,
    @Body() dto: UploadEvidenceDto,
  ) {
    return this.evidenceService.upload(req.user.id, reportId, dto);
  }

  @Get('reports/:reportId/evidence')
  @ApiOperation({ summary: 'List evidence visible to me for a report' })
  list(
    @Request() req: any,
    @Param('reportId', ParseUUIDPipe) reportId: string,
  ) {
    return this.evidenceService.list(req.user.id, reportId);
  }

  @Get('evidence/:id/file')
  @ApiOperation({ summary: 'Download an evidence file' })
  async file(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const file = await this.evidenceService.readFile(req.user.id, id);
    res.set({ 'Cache-Control': 'private, max-age=300' });
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `inline; filename="${file.fileName.replace(/"/g, '')}"`,
    });
  }

  @Put('evidence/:id/moderation')
  @ApiOperation({ summary: 'Approve or reject evidence (moderator only)' })
  moderate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateEvidenceDto,
  ) {
    return this.evidenceService.moderate(req.user.id, id, dto);
  }
}
