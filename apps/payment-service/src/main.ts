import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { PaymentServiceModule } from './payment-service.module';

async function bootstrap() {
  const app = await NestFactory.create(PaymentServiceModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PAYMENT_SERVICE_PORT ?? 3007);
}
bootstrap();
