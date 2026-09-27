import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { AuthServiceModule } from './auth-service.module';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import {
  AllExceptionsFilter,
  ResponseInterceptor,
  validationExceptionFactory,
} from './common/http';

async function bootstrap() {
  const app = await NestFactory.create(AuthServiceModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.use(cookieParser());
  app.enableCors({
    origin: ['http://localhost:5173'],
    // Lets the browser store and send the httpOnly refresh-token cookie.
    credentials: true,
  });

  await app.listen(process.env.AUTH_SERVICE_PORT ?? 3001);
}
bootstrap();
