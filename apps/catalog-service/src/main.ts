import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { CatalogServiceModule } from './catalog-service.module';

async function bootstrap() {
  const app = await NestFactory.create(CatalogServiceModule);
  await app.listen(process.env.CATALOG_SERVICE_PORT ?? 3003);
}
bootstrap();
