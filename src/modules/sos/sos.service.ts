import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { User } from '../../entities/user.entity';
import { SosAlert, SosStatus } from '../../entities/sos-alert.entity';
import { DispatchSosDto } from './sos.dto';

@Injectable()
export class SosService {
  private readonly logger = new Logger(SosService.name);
  private readonly termiiApiKey: string;
  private readonly termiiSenderId: string;
  private readonly termiiBaseUrl: string;
  private readonly googleMapsKey: string | undefined;

  constructor(
    private configService: ConfigService,
    @InjectRepository(SosAlert)
    private sosAlertRepo: Repository<SosAlert>,
  ) {
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

  /**
   * Log an SOS event for audit trail (used when SMS is sent from user's device).
   * Persists to DB and does not send any SMS — the device handles that directly via expo-sms.
   */
  async logSos(user: User, dto: DispatchSosDto) {
    const { lat, lng, batteryLevel } = dto;

    // Reverse geocode for address
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
      this.logger.error('Failed to reverse geocode SOS location', error.message);
    }

    const alert = this.sosAlertRepo.create({
      userId: user.id,
      lat,
      lng,
      address,
      batteryLevel,
      contactPhone: user.emergencyContactPhone || null,
      contactName: user.emergencyContactName || null,
      channel: 'device',
      status: SosStatus.SENT,
    });

    await this.sosAlertRepo.save(alert);

    this.logger.warn(
      `[SOS-LOG] ${user.firstName} ${user.lastName} (${user.id}) triggered device SOS — lat: ${lat}, lng: ${lng}, battery: ${batteryLevel}%, contact: ${user.emergencyContactPhone || 'none'}, alertId: ${alert.id}`,
    );

    return { logged: true, alertId: alert.id };
  }

  // ─── Admin Methods ──────────────────────────────────────────

  async findAll(page = 1, limit = 20, status?: SosStatus) {
    const qb = this.sosAlertRepo
      .createQueryBuilder('sos')
      .leftJoinAndSelect('sos.user', 'user')
      .leftJoinAndSelect('sos.resolvedBy', 'resolvedBy')
      .orderBy('sos.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (status) {
      qb.where('sos.status = :status', { status });
    }

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Unknown',
        userPhone: a.user?.phoneNumber || null,
        userRole: a.user?.role || null,
        lat: a.lat,
        lng: a.lng,
        address: a.address,
        batteryLevel: a.batteryLevel,
        contactPhone: a.contactPhone,
        contactName: a.contactName,
        status: a.status,
        channel: a.channel,
        adminNote: a.adminNote,
        resolvedById: a.resolvedById,
        resolvedByName: a.resolvedBy
          ? `${a.resolvedBy.firstName} ${a.resolvedBy.lastName}`
          : null,
        resolvedAt: a.resolvedAt,
        createdAt: a.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  async resolve(alertId: string, adminId: string, note?: string) {
    const alert = await this.sosAlertRepo.findOne({ where: { id: alertId } });
    if (!alert) throw new NotFoundException('SOS alert not found');

    alert.status = SosStatus.RESOLVED;
    alert.resolvedById = adminId;
    alert.resolvedAt = new Date();
    if (note) alert.adminNote = note;

    await this.sosAlertRepo.save(alert);
    this.logger.log(`[SOS] Alert ${alertId} resolved by admin ${adminId}`);
    return alert;
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
