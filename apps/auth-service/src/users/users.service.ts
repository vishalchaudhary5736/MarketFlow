import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 12;

export type PublicUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create({
    password,
    email,
    ...rest
  }: CreateUserDto): Promise<PublicUser> {
    try {
      return await this.prisma.user.create({
        data: {
          ...rest,
          email: email.toLowerCase(),
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        },
        omit: { passwordHash: true },
      });
    } catch (error) {
      throw this.translateKnownErrors(error);
    }
  }

  findAll(): Promise<PublicUser[]> {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      omit: { passwordHash: true },
    });
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      omit: { passwordHash: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findOne(id);
    try {
      return await this.prisma.user.update({
        where: { id },
        data: dto,
        omit: { passwordHash: true },
      });
    } catch (error) {
      throw this.translateKnownErrors(error);
    }
  }

  // Orders reference users, so rows are retired rather than removed.
  async softDelete(id: string): Promise<PublicUser> {
    await this.findOne(id);
    return this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DELETED' },
      omit: { passwordHash: true },
    });
  }

  private translateKnownErrors(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const target = (error.meta?.target as string[] | undefined)?.join(', ');
      return new ConflictException(`${target ?? 'Field'} is already in use`);
    }
    return error;
  }
}
