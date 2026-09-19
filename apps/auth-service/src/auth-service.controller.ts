import { Body, Controller, Get, Post } from '@nestjs/common';
import { User } from '@prisma/client';
import { AuthServiceService } from './auth-service.service';

@Controller()
export class AuthServiceController {
  constructor(private readonly authServiceService: AuthServiceService) {}

  @Get()
  getHello(): string {
    return this.authServiceService.getHello();
  }

  @Post('users')
  createUser(@Body() body: { email: string; password: string }): Promise<User> {
    return this.authServiceService.createUser(body.email, body.password);
  }

  @Get('users')
  findAllUsers(): Promise<User[]> {
    return this.authServiceService.findAllUsers();
  }
}
