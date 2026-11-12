import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { User } from '../entities/user.entity.js';
import type { JwtPayload } from '../interfaces/identity.interface.js';
import { getJwtSecret } from '../utils/jwt-config.js';

@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateAccessToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role as any,
      communityId: user.communityId,
    };

    return this.jwtService.sign(payload, {
      secret: getJwtSecret(this.configService, 'JWT_SECRET'),
      expiresIn: this.configService.get('JWT_ACCESS_EXPIRY') || '15m',
    });
  }

  generateRefreshToken(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      phone: user.phone,
      role: user.role as any,
      communityId: user.communityId,
    };

    return this.jwtService.sign(payload, {
      secret: getJwtSecret(this.configService, 'JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRY') || '7d',
    });
  }

  verifyAccessToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: getJwtSecret(this.configService, 'JWT_SECRET'),
    });
  }

  verifyRefreshToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: getJwtSecret(this.configService, 'JWT_REFRESH_SECRET'),
    });
  }

  decodeToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.decode(token) as JwtPayload;
    } catch {
      return null;
    }
  }
}
