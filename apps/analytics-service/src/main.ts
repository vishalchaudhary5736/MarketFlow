import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AnalyticsServiceModule } from './analytics-service.module';

async function bootstrap() {
  const app = await NestFactory.create(AnalyticsServiceModule);
  await app.listen(process.env.ANALYTICS_SERVICE_PORT ?? 3008);
}
bootstrap();
