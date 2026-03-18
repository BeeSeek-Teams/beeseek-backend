import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { User } from '../../entities/user.entity';
import { DispatchSosDto } from './sos.dto';

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);
  private readonly termiiApiKey: string;
  private readonly termiiSenderId: string;
  private readonly termiiBaseUrl: string;
  private readonly googleMapsKey: string | undefined;

  constructor(private configService: ConfigService) {
    this.termiiApiKey = this.configService.get<string>('TERMII_API_KEY') || '';
    this.termiiSenderId = this.configService.get<string>(
      'TERMII_SENDER_ID',
      'BeeSeek',
    );
    this.termiiBaseUrl = this.configService.get<string>(
      'TERMII_BASE_URL',
      'https://api.ng.termii.com',
    );
    this.googleMapsKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
  }

  async dispatchSos(user: User, dto: DispatchSosDto) {
    const { lat, lng, batteryLevel } = dto;
    const contactPhone = user.emergencyContactPhone;
    const contactName = user.emergencyContactName;

    if (!contactPhone) {
      throw new BadRequestException('No emergency contact configured');
    }

    this.logger.log(
      `SOS Dispatched by ${user.firstName} ${user.lastName} (${user.id})`,
    );

    // 1. Get readable address (don't block if it fails, but try)
    let address = 'Unknown Location';
    try {
      if (this.googleMapsKey) {
        const response = await axios.get(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${this.googleMapsKey}`,
        );
        if (response.data.results && response.data.results.length > 0) {
          address = response.data.results[0].formatted_address;
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to reverse geocode SOS location',
        error.message,
      );
    }

    // 2. Format SMS
    const mapsLink = `https://www.google.com/maps?q=${lat},${lng}`;
    const message = `EMERGENCY: ${user.firstName} ${user.lastName} triggered an SOS on BeeSeek. 
Location: ${address}
Map: ${mapsLink}
Battery: ${batteryLevel}%
Please check on them immediately.`;

    // 3. Send SMS via Termii
    return this.sendSms(contactPhone, message);
  }

  private async sendSms(to: string, message: string) {
    // Sanitize phone number for Termii (Nigeria +234)
    let sanitizedPhone = to.replace(/[^0-9]/g, '');
    if (sanitizedPhone.startsWith('0')) {
      sanitizedPhone = '234' + sanitizedPhone.substring(1);
    } else if (sanitizedPhone.length === 10) {
      sanitizedPhone = '234' + sanitizedPhone;
    }

    try {
      const payload = {
        api_key: this.termiiApiKey,
        to: sanitizedPhone,
        from: this.termiiSenderId,
        sms: message,
        type: 'plain',
        channel: 'generic',
      };

      this.logger.log(`Sending SOS SMS to ${sanitizedPhone} via Termii (from: ${this.termiiSenderId}, channel: generic)`);

      const response = await axios.post(
        `${this.termiiBaseUrl}/api/sms/send`,
        payload,
      );
      this.logger.log(
        `SOS SMS sent to ${sanitizedPhone}. Termii response: ${JSON.stringify(response.data)}`,
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to send SOS SMS via Termii: ${error.message}`);
      if (error.response) {
        this.logger.error(
          `Termii Error Detail: ${JSON.stringify(error.response.data)}`,
        );
      }
      throw new BadRequestException('Failed to deliver SOS alert');
    }
  }
}
