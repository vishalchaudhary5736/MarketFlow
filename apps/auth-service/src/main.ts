import 'dotenv/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { AuthServiceModule } from './auth-service.module';
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
      // Rejections carry the offending field, so the client can mark the input.
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Every response — success or failure — leaves through one of these two, so
  // the client only ever parses one shape.
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.AUTH_SERVICE_PORT ?? 3001);
}
bootstrap();
