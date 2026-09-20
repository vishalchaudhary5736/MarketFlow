import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { PublicUser } from '../shared/shared.types';
import { ResponseMessage } from '../common/http';

// These handlers return the row itself; the global interceptor puts it in the
// envelope under `data`, and @ResponseMessage supplies the envelope's message.
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ResponseMessage('User created successfully.')
  create(@Body() dto: CreateUserDto): Promise<PublicUser> {
    return this.usersService.create(dto);
  }

  @Get()
  @ResponseMessage('Users fetched successfully.')
  findAll(): Promise<PublicUser[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ResponseMessage('User fetched successfully.')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @ResponseMessage('User updated successfully.')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<PublicUser> {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  @ResponseMessage('User deleted successfully.')
  softDelete(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.usersService.softDelete(id);
  }
}
