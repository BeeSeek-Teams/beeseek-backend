import {
  Controller,
  Post,
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
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('single')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file'))
  async uploadSingle(
    @UploadedFile() file: MulterFile,
    @Query('folder') folder: string = 'general',
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    const result = await this.uploadsService.uploadImage(file, folder);
    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  }

  @Post('multiple')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseInterceptors(FilesInterceptor('files', 5)) // Limit to 5 files max
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
