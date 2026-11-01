import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PresignedUrlDto } from '../dto/presignedUrl.dto';
import { ReturnedPresignedUrl } from '../shared.types';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { extname } from 'path';
import { randomUUID } from 'crypto';

const SINGLE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

@Injectable()
export class S3Service {
  private readonly s3: S3Client;
  private readonly bucket: string;
  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET');
    this.s3 = new S3Client({
      region: this.config.getOrThrow<string>('AWS_REGION'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow('AWS_SECRET_ACCESS_KEY'),
      },
      // By default the SDK signs a CRC32 of the (empty) body into presigned
      // PUT URLs, so S3 rejects the real upload with a checksum mismatch.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  private createS3Path(userId: string, folder: string, fileName: string) {
    return `${folder}/${userId}/${fileName}`;
  }

  async getUploadUrl(
    dto: PresignedUrlDto,
    userId: string,
  ): Promise<ReturnedPresignedUrl[]> {
    // Larger files need multipart upload, which is not built yet.
    const tooLarge = dto.files.filter(
      (item) => item.fileSize > SINGLE_UPLOAD_MAX_BYTES,
    );
    if (tooLarge.length) {
      throw new BadRequestException(
        `Files over 100 MB are not supported: ${tooLarge
          .map((item) => item.fileName)
          .join(', ')}`,
      );
    }

    return Promise.all(
      dto.files.map(async (item) => {
        const key = this.createS3Path(
          userId,
          dto.folder,
          `${randomUUID()}${extname(item.fileName)}`,
        );
        const url = await getSignedUrl(
          this.s3,
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: item.contentType,
            // Signed into the URL, so S3 rejects a body of any other size.
            ContentLength: item.fileSize,
          }),
          { expiresIn: 300 },
        );

        return { fileId: item.fileId, key, uploadUrl: url };
      }),
    );
  }

  async deleteFile(key: string) {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { deleted: true, key };
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete file from S3');
    }
  }

  async isValidFile(key: string) {
    try {
      await this.s3.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof NotFound ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw new InternalServerErrorException('Failed to upload file from S3');
    }
  }
}
