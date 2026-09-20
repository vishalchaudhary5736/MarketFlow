import { Injectable, NotFoundException } from '@nestjs/common';
import { SharedService } from '../shared/shared.service';
import { PublicUser } from '../shared/shared.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly sharedService: SharedService) {}

  async create({
    password,
    email,
    ...rest
  }: CreateUserDto): Promise<PublicUser> {
    try {
      return await this.sharedService.prisma.user.create({
        data: {
          ...rest,
          email: email.toLowerCase(),
          passwordHash: await this.sharedService.hashPassword(password),
        },
        omit: { passwordHash: true },
      });
    } catch (error) {
      throw this.sharedService.translateKnownErrors(error);
    }
  }

  findAll(): Promise<PublicUser[]> {
    return this.sharedService.prisma.user.findMany({
      where: { deletedAt: null },
      omit: { passwordHash: true },
    });
  }

  async findOne(id: string): Promise<PublicUser> {
    const user = await this.sharedService.prisma.user.findFirst({
      where: { id, deletedAt: null },
      omit: { passwordHash: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<PublicUser> {
    await this.findOne(id);
    try {
      return await this.sharedService.prisma.user.update({
        where: { id },
        data: dto,
        omit: { passwordHash: true },
      });
    } catch (error) {
      throw this.sharedService.translateKnownErrors(error);
    }
  }

  // Orders reference users, so rows are retired rather than removed.
  async softDelete(id: string): Promise<PublicUser> {
    await this.findOne(id);
    return this.sharedService.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DELETED' },
      omit: { passwordHash: true },
    });
  }
}
