import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { requestContext } from './common/request-context.middleware.js';
import { securityHeaders } from './common/security-headers.middleware.js';
import {
  parseProxyTrust,
  validateProductionEnvironment,
} from './config/env.validation.js';

async function bootstrap() {
  validateProductionEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', parseProxyTrust(process.env.TRUST_PROXY));
  app.use(requestContext);
  app.use(securityHeaders);
  const bodyLimit = process.env.JSON_BODY_LIMIT || '8mb';
  app.use(
    json({
      limit: bodyLimit,
      verify: (req: any, _res, buffer) => {
        req.rawBody = buffer;
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://127.0.0.1:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    credentials: false,
    optionsSuccessStatus: 204,
  });
  app.enableShutdownHooks();
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Neighbourhood Signal API')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, config),
    );
  }
  await app.listen(
    process.env.PORT || 3000,
    process.env.BIND_HOST || '127.0.0.1',
  );
}
await bootstrap();
