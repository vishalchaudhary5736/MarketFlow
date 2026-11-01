import { IsBoolean } from 'class-validator';

export class SkipUser {
  @IsBoolean()
  skip: boolean;
}
