import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [SharedModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {
  constructor() {}
}
