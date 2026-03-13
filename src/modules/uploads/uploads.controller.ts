import {
  Controller,
  Post,
  Logger,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { UploadsService } from './uploads.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Request } from 'express';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  private readonly logger = new Logger(UploadsController.name);

  constructor(private readonly uploadsService: UploadsService) {}

  @Post('single')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadSingle(
    @UploadedFile() file: MulterFile,
    @Query('folder') folder: string = 'general',
  ) {
    if (!file) {
      this.logger.warn('Upload attempt with no file attached');
      throw new BadRequestException('File is required');
    }
    this.logger.log(`Upload: name=${file.originalname}, mime=${file.mimetype}, size=${file.size}, folder=${folder}`);
    try {
      const result = await this.uploadsService.uploadImage(file, folder);
      return {
        url: result.secure_url,
        publicId: result.public_id,
      };
    } catch (error: any) {
      this.logger.error(`Upload failed: ${error.message}`);
      throw error;
    }
  }

  @Post('multiple')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadMultiple(
    @UploadedFiles() files: MulterFile[],
    @Query('folder') folder: string = 'general',
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Files are required');
    }
    const results = await this.uploadsService.uploadMultiple(files, folder);
    return results.map((result) => ({
      url: result.secure_url,
      publicId: result.public_id,
    }));
  }
}
