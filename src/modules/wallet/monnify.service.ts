import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import { User } from '../../entities/user.entity';

interface MonnifyAuthResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseBody: {
    accessToken: string;
    expiresIn: number;
  };
}

interface MonnifyReservedAccountResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseBody?: {
    accountNumber: string;
    accountName: string;
    currencyCode: string;
    contractCode: string;
    accountReference: string;
    reservationReference: string;
    incomeSplitConfig: any[];
    createdOn: string;
    status: string;
  };
}

@Injectable()
export class MonnifyService {
  private axiosInstance: AxiosInstance;
  private accessToken: string;
  private tokenExpiresAt: number = 0; // Unix timestamp (ms) when token expires
  private readonly logger = new Logger(MonnifyService.name);
  private readonly baseUrl =
    process.env.MONNIFY_SANDBOX_MODE === 'true'
      ? 'https://sandbox.monnify.com'
      : 'https://api.monnify.com';

  constructor() {
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });
  }

  /**
   * Authenticate with Monnify API
   */
  async authenticate(): Promise<string> {
    try {
      const apiKey = process.env.MONNIFY_API_KEY;
      const secretKey = process.env.MONNIFY_SECRET_KEY;
      const authBase64 = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

      const response = await axios.post<MonnifyAuthResponse>(
        `${this.baseUrl}/api/v1/auth/login`,
        {},
        {
          headers: {
            Authorization: `Basic ${authBase64}`,
          },
          timeout: 10000,
        },
      );

      if (!response.data.requestSuccessful) {
        throw new Error(
          `Authentication failed: ${response.data.responseMessage}`,
        );
      }

      this.accessToken = response.data.responseBody.accessToken;
      // Monnify tokens expire in `expiresIn` seconds; refresh 60s early for safety
      const expiresInMs = (response.data.responseBody.expiresIn - 60) * 1000;
      this.tokenExpiresAt = Date.now() + expiresInMs;
      return this.accessToken;
    } catch (error) {
      this.logger.error('Monnify authentication failed', error);
      throw new HttpException(
        'Unable to authenticate with payment provider',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Returns a valid Monnify access token, proactively refreshing if expired or close to expiry.
   */
  private async getValidToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
      await this.authenticate();
    }
    return this.accessToken;
  }

  /**
   * Create reserved account (NUBAN) for user
   */
  async createReservedAccount(user: User): Promise<{
    nuban: string;
    accountName: string;
    accountId: string;
  }> {
    try {
      const token = await this.getValidToken();

      const accountReference = `${user.id}-${Date.now()}`;
      const accountName = `${user.firstName} ${user.lastName}`;

      const response =
        await this.axiosInstance.post<MonnifyReservedAccountResponse>(
          '/api/v2/bank-transfer/reserved-accounts',
          {
            contractCode: process.env.MONNIFY_CONTRACT_CODE,
            accountReference: accountReference,
            accountName: accountName,
            currencyCode: 'NGN',
            customerName: accountName,
            customerEmail: user.email,
            getAllAvailableBanks: false,
            preferredBanks: ['035', '050'],
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          },
        );

      if (!response.data.requestSuccessful) {
        throw new Error(
          `Account creation failed: ${response.data.responseMessage}`,
        );
      }

      const body = response.data.responseBody;

      return {
        nuban: body?.accountNumber || '',
        accountName: body?.accountName || '',
        accountId: body?.accountReference || '',
      };
    } catch (error) {
      const status = error.response?.status;
      const monnifyMsg = error.response?.data?.responseMessage || error.message;
      const monnifyCode = error.response?.data?.responseCode;
      this.logger.error(
        `Failed to create reserved account for user ${user.id} — HTTP ${status}: ${monnifyMsg} (code: ${monnifyCode})`,
      );
      this.logger.error(`Monnify full response: ${JSON.stringify(error.response?.data)}`);
      throw new HttpException(
        `Unable to create wallet account: ${monnifyMsg}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance(accountReference: string): Promise<number> {
    try {
      const token = await this.getValidToken();

      const response = await this.axiosInstance.get(
        `/api/v2/bank-transfer/reserved-accounts/${accountReference}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      return response.data.responseBody?.balance || 0;
    } catch (error) {
      this.logger.error(
        `Failed to get balance for account ${accountReference}`,
        error,
      );
      return 0;
    }
  }

  /**
   * Get transaction history
   */
  async getTransactionHistory(
    accountReference: string,
    pageSize: number = 10,
    pageNumber: number = 1,
  ): Promise<any[]> {
    try {
      const token = await this.getValidToken();

      const response = await this.axiosInstance.get(
        '/api/v1/bank-transfer/reserved-accounts/transactions',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            accountReference,
            page: pageNumber - 1,
            size: pageSize,
          },
        },
      );

      return response.data.responseBody?.transactions || [];
    } catch (error) {
      this.logger.error(
        `Failed to get transaction history for ${accountReference}`,
        error,
      );
      return [];
    }
  }

  /**
   * Verify NIN with Monnify (Detailed)
   * NOTE: Monnify Verification APIs only work in LIVE mode, not sandbox.
   */
  async verifyNIN(ninNumber: string): Promise<{
    verified: boolean;
    name?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    error?: string;
  }> {
    // Monnify verification endpoints are live-only
    if (process.env.MONNIFY_SANDBOX_MODE === 'true') {
      this.logger.warn('NIN verification skipped — Monnify sandbox does not support Verification APIs. Set MONNIFY_SANDBOX_MODE=false for live.');
      return { verified: false, error: 'NIN verification is not available in sandbox mode' };
    }

    try {
      const token = await this.getValidToken();

      const response = await this.axiosInstance.post(
        '/api/v1/vas/nin-details',
        {
          nin: ninNumber,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.data.requestSuccessful && response.data.responseBody) {
        const body = response.data.responseBody;
        const fullName = [body.firstName, body.middleName, body.lastName]
          .filter(Boolean)
          .join(' ');

        return {
          verified: true,
          name: fullName,
          firstName: body.firstName,
          lastName: body.lastName,
          dateOfBirth: body.dateOfBirth,
        };
      }

      this.logger.warn(`NIN verification returned unsuccessful for ${ninNumber}`, {
        message: response.data.responseMessage,
        code: response.data.responseCode,
      });
      return { verified: false, error: response.data.responseMessage };
    } catch (error) {
      const status = error.response?.status;
      const monnifyMsg = error.response?.data?.responseMessage || error.message;
      this.logger.warn(`NIN verification failed for ${ninNumber} — HTTP ${status}: ${monnifyMsg}`);
      return { verified: false, error: monnifyMsg };
    }
  }

  /**
   * Initiate transfer (for wallet withdrawals)
   */
  async initiateTransfer(
    accountReference: string,
    amount: number,
    narration: string,
    destinationBankCode: string,
    destinationAccountNumber: string,
  ): Promise<{ transactionReference: string }> {
    try {
      const token = await this.getValidToken();

      const transactionReference = `TXN-${Date.now()}-${randomUUID().slice(0, 9)}`;

      // DISBURSEMENT: disburse from the platform's Wallet/Disbursement Account
      const sourceAccount = accountReference || process.env.MONNIFY_SOURCE_ACCOUNT;

      if (!sourceAccount) {
        throw new Error('No source account specified for disbursement');
      }

      const response = await this.axiosInstance.post(
        '/api/v2/disbursements/single',
        {
          amount,
          reference: transactionReference,
          narration,
          destinationBankCode,
          destinationAccountNumber,
          sourceAccountNumber: sourceAccount,
          currency: 'NGN',
          async: false
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.data.requestSuccessful) {
        throw new Error(`Transfer failed: ${response.data.responseMessage}`);
      }

      return { transactionReference };
    } catch (error) {
      this.logger.error(
        `Transfer failed for account ${accountReference}`,
        error,
      );
      throw new HttpException(
        'Transfer failed. Please try again later.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Get list of supported banks
   */
  async getBanks(): Promise<any[]> {
    try {
      const token = await this.getValidToken();

      const response = await this.axiosInstance.get('/api/v1/banks', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.data.requestSuccessful) {
        throw new Error(`Monnify Error: ${response.data.responseMessage}`);
      }

      return response.data.responseBody || [];
    } catch (error) {
      this.logger.error('Failed to fetch banks from Monnify', {
        message: error.message,
        status: error.response?.status
      });
      throw new HttpException(
        'Unable to fetch banks',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Validate account details
   */
  async validateAccount(accountNumber: string, bankCode: string): Promise<any> {
    try {
      const token = await this.getValidToken();

      const response = await this.axiosInstance.get(
        '/api/v1/disbursements/account/validate',
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            accountNumber,
            bankCode,
          },
        },
      );

      if (!response.data.requestSuccessful) {
        throw new Error(response.data.responseMessage);
      }

      return response.data.responseBody;
    } catch (error) {
      this.logger.error(
        `Account validation failed for ${accountNumber} at ${bankCode}`,
        error,
      );
      throw new HttpException(
        error.message || 'Account validation failed',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
