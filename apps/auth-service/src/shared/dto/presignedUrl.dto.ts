import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PresignedFileDto {
  @IsString()
  @IsNotEmpty()
  fileId: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  // Bytes, as given by the browser's File.size.
  @IsInt()
  @IsPositive()
  fileSize: number;
}

export class PresignedUrlDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PresignedFileDto)
  files: PresignedFileDto[];

  @IsString()
  @IsNotEmpty()
  folder: string;
}
