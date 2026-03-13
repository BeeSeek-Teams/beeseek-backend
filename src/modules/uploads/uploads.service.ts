import { Injectable, BadRequestException } from '@nestjs/common';
import cloudinary from '../../config/cloudinary.config';
import { UploadApiErrorResponse, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',   // React Native sometimes sends image/jpg (from file extension)
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'application/octet-stream', // Fallback when mime detection fails on mobile
];

@Injectable()
export class UploadsService {
  private validateFile(file: MulterFile): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
      );
    }
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type '${file.mimetype}' is not allowed. Accepted: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
  }

  async uploadImage(
    file: MulterFile,
    folder: string,
  ): Promise<UploadApiResponse | UploadApiErrorResponse> {
    return new Promise((resolve, reject) => {
      this.validateFile(file);

      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `beeseek/${folder}`,
          resource_type: 'auto',
          // Optimize for web on the server side as a fallback
          transformation: [
            { width: 1000, crop: 'limit' },
            { quality: 'auto' },
            { fetch_format: 'auto' },
          ],
        },
        (error: any, result?: UploadApiResponse) => {
          if (error) return reject(error);
          if (!result) return reject(new Error('Upload failed'));
          resolve(result);
        },
      );

      const readableStream = new Readable();
      readableStream.push(file.buffer);
      readableStream.push(null);
      readableStream.pipe(uploadStream);
    });
  }

  async uploadMultiple(
    files: MulterFile[],
    folder: string,
  ): Promise<(UploadApiResponse | UploadApiErrorResponse)[]> {
    files.forEach((file) => this.validateFile(file));
    const uploadPromises = files.map((file) => this.uploadImage(file, folder));
    return Promise.all(uploadPromises);
  }

  async deleteImage(publicId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(publicId, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
    });
  }
}
