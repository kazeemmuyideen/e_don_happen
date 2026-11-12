import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from './entities/community.entity.js';
import { Responder } from './entities/responder.entity.js';
import { User } from '../identity/entities/user.entity.js';
import { CommunityService } from './community.service.js';
import { CommunityController } from './community.controller.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [
    IdentityModule,
    TypeOrmModule.forFeature([Community, Responder, User]),
  ],
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
