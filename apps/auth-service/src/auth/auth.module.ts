import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AdminAuthcontroller } from './admin-auth.controller';
import { TwoFaService } from './two.factor.service';
import { ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    SharedModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  providers: [AuthService, TwoFaService],
  controllers: [AuthController, AdminAuthcontroller],
  exports: [AuthService, TwoFaService],
})
export class AuthModule {}
