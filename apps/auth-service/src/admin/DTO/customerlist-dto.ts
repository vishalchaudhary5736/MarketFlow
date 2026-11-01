import { IsEmail, IsEnum, IsString } from 'class-validator';
import { email } from '../constant';

export type customerList = {
  pageNo: string;
  pageLimit: string;
  status: string;
  search: string;
  email: email;
  order: customerOrder;
};

export type customerOrder = {
  lebal: string;
  key: string;
  value: string;
};

export class CustomerList {
  @IsString()
  pageNo: string;

  @IsString()
  pageLimit: string;

  @IsEnum(email)
  email: email;

  @IsString()
  status: string;
}
