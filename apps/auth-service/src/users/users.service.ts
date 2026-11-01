import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SharedService } from '../shared/shared.service';
import { PublicUser } from '../shared/shared.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PresignedUrlDto } from '../shared/dto/presignedUrl.dto';
import { UpdateProfile } from './dto/updateProfile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly sharedService: SharedService) {}

  async skipProfile(userId: string, skip: boolean) {
    await this.sharedService.prisma.user.update({
      where: { id: userId },
      data: {
        isProfileSkip: skip,
      },
      select: {
        id: true,
        isProfileSkip: true,
      },
    });

    return {
      success: true,
      message: 'Success',
    };
  }

  async updateProfile(dto: UpdateProfile, userId: string) {
    let key: string | null = null;
    if (dto.avatarUrl) {
      const isvalidUrl = await this.sharedService.isValidUrl(dto.avatarUrl);
      if (!isvalidUrl) {
        throw new BadRequestException('File does not exist in S3');
      }
      const userDetail = await this.sharedService.prisma.user.findUnique({
        where: { id: userId },
        select: {
          avatarUrl: true,
        },
      });
      key = userDetail?.avatarUrl ? userDetail.avatarUrl : null;
    }

    const result = await this.sharedService.prisma.user.update({
      where: { id: userId },
      data: dto,
      omit: {
        passwordHash: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        deletedAt: true,
      },
    });

    // TO-DO
    if (key) {
    }

    return {
      success: true,
      message: 'Profile updated successfully.',
      data: {
        userDetail: result,
      },
    };
  }

  async generatePresignedUrl(dto: PresignedUrlDto, userId: string) {
    const uploadUrls = await this.sharedService.getUploadUrl(dto, userId);
    return {
      success: true,
      uploadUrls,
    };
  }

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
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No user exists with this id.',
        action: 'RETRY',
        userId: id,
      });
    }
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
