import { Injectable } from '@nestjs/common';
import { customerList } from './DTO/customerlist-dto';

@Injectable()
export class AdminService {
  constructor() {}

  async customerList(query: customerList) {}
}
