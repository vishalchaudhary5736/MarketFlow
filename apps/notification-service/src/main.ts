import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NotificationServiceModule } from './notification-service.module';

async function bootstrap() {
  const app = await NestFactory.create(NotificationServiceModule);
  await app.listen(process.env.NOTIFICATION_SERVICE_PORT ?? 3005);
}
bootstrap();
