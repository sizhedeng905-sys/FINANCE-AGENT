import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('nodeEnv') ?? 'development';
  const allowedOrigins = new Set(configService.get<string[]>('corsOrigins') ?? []);
  const trustProxyHops = configService.get<number>('trustProxyHops') ?? 0;
  const trustedProxies = configService.get<string[]>('trustedProxies') ?? [];
  if (trustedProxies.length > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies);
  else if (trustProxyHops > 0) app.getHttpAdapter().getInstance().set('trust proxy', trustProxyHops);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: nodeEnv === 'production' ? undefined : false
  }));

  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'Idempotency-Key',
      'X-Request-Id',
      'X-CSRF-Token',
      'traceparent'
    ],
    exposedHeaders: ['X-Request-Id', 'traceparent', 'Content-Disposition', 'Content-Length', 'X-File-Trust'],
    credentials: true
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true
      }
    })
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor(), new ResponseInterceptor());

  if (configService.get<boolean>('swaggerEnabled') ?? true) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('FINANCE-AGENT Backend API')
      .setDescription('Phase 0-10 backend for the logistics AI finance operations system.')
      .setVersion('0.10.0')
      .addBearerAuth()
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, swaggerDocument);
  }

  const port = configService.get<number>('port') ?? 3001;
  const host = configService.get<string>('host') ?? '127.0.0.1';
  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
