import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuthServiceService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!';
  }

  createUser(email: string, password: string): Promise<User> {
    return this.prisma.user.create({ data: { email, password } });
  }

  findAllUsers(): Promise<User[]> {
    return this.prisma.user.findMany();
  }
}
