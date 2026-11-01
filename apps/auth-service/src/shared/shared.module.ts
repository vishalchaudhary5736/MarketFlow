import { Module } from '@nestjs/common';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { SharedService } from './shared.service';
import { S3Service } from './config/s3Config';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(process.cwd(), '.env'),
      cache: true,
    }),
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
  providers: [SharedService, S3Service],
  exports: [PrismaModule, JwtModule, SharedService],
})
export class SharedModule {}
