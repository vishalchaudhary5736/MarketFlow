import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { SharedService } from './shared.service';

@Module({
  imports: [
    PrismaModule,
    CacheModule.registerAsync({
      useFactory: () => ({
        stores: [
          createKeyv(
            `redis://${process.env.REDIS_USERNAME ?? ''}:${process.env.REDIS_PASSWORD ?? ''}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
          ),
        ],
        ttl: Number(process.env.REDIS_TTL),
      }),
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_ACCESS_SECRET,
      signOptions: {
        expiresIn: (process.env.JWT_ACCESS_TTL ??
          '15m') as JwtSignOptions['expiresIn'],
      },
    }),
  ],
  providers: [SharedService],
  exports: [PrismaModule, JwtModule, SharedService],
})
export class SharedModule {}
