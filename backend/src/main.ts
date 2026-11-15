import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module.js';
import { securityHeaders } from './common/security-headers.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
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
  });
  app.enableShutdownHooks();
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
  await app.listen(process.env.PORT || 3000, '127.0.0.1');
}
await bootstrap();
