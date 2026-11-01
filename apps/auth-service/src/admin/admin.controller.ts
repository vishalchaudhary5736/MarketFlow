import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Req,
} from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin/dashboard')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('/customers/list')
  @HttpCode(HttpStatus.OK)
  customerList(@Req() req: any, @Query() query: any) {
    return this.adminService.customerList(query);
  }
}
