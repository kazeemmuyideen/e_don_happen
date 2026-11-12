import { Module } from '@nestjs/common';
import { NipostClient } from './nipost.client.js';
import { PostcodeController } from './postcode.controller.js';
import { PostcodeService } from './postcode.service.js';

@Module({
  controllers: [PostcodeController],
  providers: [NipostClient, PostcodeService],
  exports: [PostcodeService],
})
export class PostcodeModule {}
