import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { CartServiceModule } from './cart-service.module';

async function bootstrap() {
  const app = await NestFactory.create(CartServiceModule);
  await app.listen(process.env.CART_SERVICE_PORT ?? 3002);
}
bootstrap();
