import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { RedisCacheModule } from '../lib/cacheService/cache.module';

// Registered with no secret on purpose: access and refresh tokens are signed
// with different secrets, so each is supplied per call in AuthService.
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({}),
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        stores: [
          createKeyv(
            `redis://${process.env.REDIS_USERNAME ?? ''}:${process.env.REDIS_PASSWORD ?? ''}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
          ),
        ],
        ttl: Number(process.env.REDIS_TTL),
      }),
    }),
    RedisCacheModule,
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
