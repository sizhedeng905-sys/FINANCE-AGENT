import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  process.env.PROCESS_ROLE = 'worker';
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  logger.log(JSON.stringify({ type: 'worker_ready', pid: process.pid }));
}

void bootstrap();
