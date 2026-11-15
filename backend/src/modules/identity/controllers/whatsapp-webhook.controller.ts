import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { WhatsAppService } from '../services/whatsapp.service.js';

@ApiExcludeController()
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly whatsapp: WhatsAppService) {}

  @Get()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    this.whatsapp.verifyChallenge(mode, token);
    return challenge || '';
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  receive(@Req() req: any, @Body() body: any) {
    this.whatsapp.verifySignature(req.rawBody, req.headers['x-hub-signature-256']);
    const statuses =
      body?.entry?.flatMap((entry: any) =>
        entry?.changes?.flatMap((change: any) =>
          change?.value?.statuses ? change.value.statuses : [],
        ),
      ) || [];
    const messages =
      body?.entry?.flatMap((entry: any) =>
        entry?.changes?.flatMap((change: any) =>
          change?.value?.messages ? change.value.messages : [],
        ),
      ) || [];
    return { received: true, statuses: statuses.length, messages: messages.length };
  }
}
