import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AnalyticsServiceModule } from './analytics-service.module';

async function bootstrap() {
  const app = await NestFactory.create(AnalyticsServiceModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.ANALYTICS_SERVICE_PORT ?? 3008);
}
bootstrap();
