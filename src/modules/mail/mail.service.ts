import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService implements OnModuleInit {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    // smtp.hostinger.com resolves to Cloudflare IPs which do NOT proxy SMTP traffic.
    // smtp.titan.email is Hostinger's actual Titan email SMTP server (AWS-hosted, directly reachable).
    const host = this.configService.get('SMTP_HOST', 'smtp.titan.email');
    const port = Number(this.configService.get('SMTP_PORT', 587));
    const user = this.configService.get('EMAIL_USER', 'no-reply@beeseek.site');
    const pass = this.configService.get<string>('EMAIL_PASS');
    const secure = port === 465;

    this.logger.log(
      `MailService config: host=${host}, port=${port}, secure=${secure}, user=${user}, pass=${pass ? '***SET***' : '!!!MISSING!!!'}`,
    );

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2',
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }

  async onModuleInit() {
    this.transporter.verify().then(() => {
      this.logger.log('SMTP connection verified successfully');
    }).catch((err: any) => {
      this.logger.error('SMTP connection verification FAILED:', err.message);
    });
  }

  private readonly commonStyles = `
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #031745;
    background-color: #F8F9FA;
  `;

  private wrapTemplate(content: string) {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="${this.commonStyles} margin: 0; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background: #FFFFFF; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border: 1px solid #E5E5E5;">
          <div style="padding: 40px 32px;">
            ${content}
            
            <div style="margin-top: 40px; padding-top: 24px; border-top: 1px solid #E5E5E5; color: #6B7280; font-size: 14px; text-align: center;">
              <p style="margin: 0;">&copy; 2026 BeeSeek. All rights reserved.</p>
              <p style="margin: 4px 0 0 0;">Connecting Nigerians to verified services.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendOTP(
    to: string,
    name: string,
    code: string,
    type: 'VERIFICATION' | 'PASSWORD_RESET',
  ) {
    const isReset = type === 'PASSWORD_RESET';
    const title = isReset ? 'Reset Your Password' : 'Verify Your Account';
    const description = isReset
      ? 'Use the code below to reset your password and secure your account.'
      : 'Thank you for choosing BeeSeek. Use the code below to verify your email address.';

    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">${title}</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 32px 0;">
        Hello ${name},<br><br>${description}
      </p>
      
      <div style="background-color: #F3F4F6; border-radius: 12px; padding: 32px; text-align: center; margin-bottom: 32px;">
        <div style="font-size: 36px; font-weight: 700; color: #031745; letter-spacing: 8px; font-family: 'Courier New', Courier, monospace;">${code}</div>
      </div>
      
      <p style="font-size: 14px; color: #6B7280; text-align: center; margin: 0;">
        This security code is valid for 15 minutes. If you did not initiate this request, please contact our security team immediately.
      </p>
    `);

    return this.sendMail(to, title, html);
  }

  async sendWelcomeClient(to: string, name: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Welcome to BeeSeek, ${name}</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Your account has been successfully created. BeeSeek connects you with verified professional agents for various service needs across Nigeria.
      </p>
      
      <h3 style="color: #031745; margin: 32px 0 16px 0; font-size: 18px;">Next Steps</h3>
      <div style="margin-bottom: 32px;">
        <p style="color: #4B5563; margin: 12px 0;"><b>1. Verify Identity:</b> Provide your National Identification Number (NIN) to enhance account trust.</p>
        <p style="color: #4B5563; margin: 12px 0;"><b>2. Explore Services:</b> Search for and hire skilled professionals in your immediate vicinity.</p>
        <p style="color: #4B5563; margin: 12px 0;"><b>3. Wallet Setup:</b> Securely fund your wallet for transparent and efficient transactions.</p>
      </div>

      <a href="https://beeseek.site/app" style="display: inline-block; background: #031745; color: #FFFFFF; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; text-align: center;">Access Your Account</a>
    `);

    return this.sendMail(to, 'Welcome to BeeSeek', html);
  }

  async sendWelcomeAgent(to: string, name: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Welcome to the BeeSeek Professional Network</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name}, your registration as a service provider is complete. You are now part of a community committed to excellence and professional service delivery.
      </p>
      
      <h3 style="color: #031745; margin: 32px 0 16px 0; font-size: 18px;">Getting Started</h3>
      <div style="margin-bottom: 32px;">
        <p style="color: #4B5563; margin: 12px 0;"><b>Profile Completion:</b> Ensure your professional details and certifications are accurately listed.</p>
        <p style="color: #4B5563; margin: 12px 0;"><b>NIN Verification:</b> This is a required step before you can receive service requests.</p>
        <p style="color: #4B5563; margin: 12px 0;"><b>Availability:</b> Keep your status and location current to receive relevant inquiries.</p>
      </div>

      <a href="https://beeseek.site/agent" style="display: inline-block; background: #031745; color: #FFFFFF; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; text-align: center;">Agent Dashboard</a>
    `);

    return this.sendMail(to, 'BeeSeek Professional Registration', html);
  }

  async sendInvoice(to: string, name: string, data: any) {
    const { contract, transaction } = data;
    const formattedDate = new Date().toLocaleDateString('en-NG', {
      year: 'numeric', month: 'long', day: 'numeric'
    });

    // Calculate material cost from items array
    const materialCost = (contract.materials || []).reduce(
      (sum: number, item: any) => sum + (Number(item.cost) || 0), 
      0
    );

    const totalPaidKobo = Number(contract.totalCost) + Number(contract.serviceFee);

    const html = this.wrapTemplate(`
      <div style="border-bottom: 2px solid #F3F4F6; padding-bottom: 24px; margin-bottom: 24px;">
        <h1 style="font-size: 24px; font-weight: 700; margin: 0; color: #031745;">Official Receipt / Invoice</h1>
        <p style="color: #6B7280; margin: 4px 0 0 0;">Invoice ID: ${contract.id.slice(0, 8).toUpperCase()}</p>
        <p style="color: #6B7280; margin: 2px 0 0 0;">Date: ${formattedDate}</p>
      </div>

      <p style="font-size: 16px; color: #4B5563;">Hello ${name},</p>
      <p style="font-size: 16px; color: #4B5563; margin-bottom: 32px;">
        This document serves as an official confirmation of payment for services rendered via the BeeSeek platform.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 32px;">
        <thead>
          <tr style="border-bottom: 2px solid #F3F4F6;">
            <th style="text-align: left; padding: 12px 0; color: #031745;">Description</th>
            <th style="text-align: right; padding: 12px 0; color: #031745;">Amount (₦)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 12px 0; color: #4B5563;">Service Workmanship</td>
            <td style="text-align: right; padding: 12px 0; color: #4B5563;">${(Number(contract.workmanshipCost) / 100).toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #4B5563;">Transport Fare</td>
            <td style="text-align: right; padding: 12px 0; color: #4B5563;">${(Number(contract.transportFare) / 100).toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #4B5563;">Material Costs</td>
            <td style="text-align: right; padding: 12px 0; color: #4B5563;">${(materialCost / 100).toLocaleString()}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #4B5563;">Platform Service Fee</td>
            <td style="text-align: right; padding: 12px 0; color: #4B5563;">${(Number(contract.serviceFee) / 100).toLocaleString()}</td>
          </tr>
          <tr style="border-top: 2px solid #031745;">
            <td style="padding: 16px 0; font-weight: 700; color: #031745;">Total Paid</td>
            <td style="text-align: right; padding: 16px 0; font-weight: 700; color: #031745; font-size: 18px;">₦${(totalPaidKobo / 100).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <div style="background-color: #F9FAFB; border-radius: 8px; padding: 20px; margin-bottom: 32px;">
        <p style="margin: 0; font-size: 14px; color: #6B7280;"><b>Agent details:</b> ${contract.agent.firstName} ${contract.agent.lastName}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: #6B7280;"><b>Transaction Ref:</b> ${transaction.id}</p>
      </div>

      <p style="font-size: 14px; color: #9CA3AF; text-align: center; line-height: 1.4;">
        BeeSeek is a marketplace platform. This invoice represents the transaction between the Client and the Service Provider (Agent). For tax and legal purposes, please retain this copy.
      </p>
    `);

    return this.sendMail(to, `Invoice: ${contract.id.slice(0, 8).toUpperCase()}`, html);
  }

  async sendAutoReleaseNotification(
    to: string,
    name: string,
    role: 'CLIENT' | 'AGENT',
    contractId: string,
    amount: number,
  ) {
    const isClient = role === 'CLIENT';
    const amountNaira = (amount / 100).toLocaleString();
    const title = 'Automated Payment Release Notification';
    const description = isClient
      ? `This is an official notification that the payment for contract #${contractId.slice(0, 8).toUpperCase()} has been automatically released following the mandatory 48-hour completion period, as outlined in the BeeSeek Service Agreement.`
      : `The funds for contract #${contractId.slice(0, 8).toUpperCase()} have been automatically released to your wallet following the 48-hour post-completion period.`;

    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">${title}</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 32px 0;">
        Dear ${name},<br><br>${description}
      </p>
      
      <div style="background-color: #F3F4F6; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
        <div style="font-size: 14px; color: #6B7280; margin-bottom: 8px;">TOTAL DISBURSED</div>
        <div style="font-size: 28px; font-weight: 700; color: #031745;">₦${amountNaira}</div>
      </div>
      
      <p style="font-size: 14px; color: #6B7280; line-height: 1.5; margin-bottom: 24px;">
        ${isClient ? 'If you have any questions or require support regarding this transaction, please contact our support team within 24 hours of this notification.' : 'The disbursed funds are now available in your BeeSeek wallet for withdrawal or other transactions.'}
      </p>

      <p style="font-size: 14px; color: #9CA3AF; text-align: center; line-height: 1.4;">
        BeeSeek is a marketplace platform. This notification represents the automated execution of the Service Agreement between the Client and the Service Provider.
      </p>
    `);

    return this.sendMail(to, title, html);
  }

  async sendNINReminder(to: string, name: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 28px; font-weight: 800; margin: 0 0 16px 0; color: #031745;">Complete Your Verification</h1>
      <p style="font-size: 16px; line-height: 24px; color: #6B7280; margin: 0 0 24px 0;">
        Hi ${name}, we noticed you haven't verified your identity yet. Verification is key to building trust in our community.
      </p>
      
      <div style="background-color: #FFF9E6; border-left: 4px solid #DE852C; padding: 16px; margin: 24px 0; border-radius: 8px;">
        <p style="color: #DE852C; margin: 0; font-weight: 600;">Why Verify?</p>
        <p style="color: #6B7280; margin: 8px 0 0 0; font-size: 14px;">Verified users get 3x more bookings and have access to higher wallet limits.</p>
      </div>

      <p style="font-size: 16px; color: #6B7280; margin: 32px 0;">
        Have your 11-digit National Identification Number (NIN) ready and click below to get verified instantly.
      </p>

      <a href="#" style="display: block; background: #031745; color: #FFFFFF; text-decoration: none; padding: 16px 32px; border-radius: 12px; font-weight: 700; text-align: center;">Verify My Identity Now</a>
    `);

    return this.sendMail(to, 'Identity Verification Required', html);
  }

  private async sendMail(to: string, subject: string, html: string) {
    const from = this.configService.get(
      'FROM_EMAIL',
      this.configService.get('EMAIL_USER', 'no-reply@beeseek.site'),
    );
    this.logger.log(`Attempting to send email to=${to}, subject="${subject}", from=${from}`);
    try {
      const info = await this.transporter.sendMail({
        from: `"BeeSeek" <${from}>`,
        to,
        subject,
        html,
      });
      this.logger.log(`Email sent successfully: messageId=${info.messageId}, response=${info.response}`);
      return info;
    } catch (error: any) {
      this.logger.error(
        `FAILED to send email to ${to}: ${error.message} | code=${error.code} | command=${error.command} | responseCode=${error.responseCode}`,
      );
      throw error;
    }
  }

  async sendWithdrawalNotification(to: string, name: string, data: { amount: string, bank: string, account: string, reference: string, fee: string }) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Withdrawal Initiated</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Your withdrawal request of <strong>₦${data.amount}</strong> has been successfully initiated and is being processed by the bank.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Destination Bank</td>
            <td style="padding: 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right;">${data.bank}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Account Number</td>
            <td style="padding: 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right;">${data.account}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Transaction Fee</td>
            <td style="padding: 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right;">₦${data.fee}</td>
          </tr>
          <tr>
            <td style="padding: 16px 0 8px 0; color: #6B7280; font-size: 14px; border-top: 1px solid #E5E5E5;">Reference</td>
            <td style="padding: 16px 0 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right; border-top: 1px solid #E5E5E5;">${data.reference}</td>
          </tr>
        </table>
      </div>

      <p style="font-size: 14px; color: #6B7280; margin: 0;">
        Funds typically arrive within minutes, but can take up to 24 hours depending on bank network stability.
      </p>
    `);

    return this.sendMail(to, 'Withdrawal Notification - BeeSeek', html);
  }

  async sendAccountReactivatedEmail(to: string, name: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Welcome Back to BeeSeek!</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        We're pleased to inform you that your BeeSeek account has been successfully <strong>reactivated</strong> by our support team.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <p style="font-size: 14px; color: #4B5563; margin: 0;">
          All your history, work records, and wallet balance have been fully restored. You can now log back into the app and continue using your account as usual.
        </p>
      </div>

      <p style="font-size: 14px; color: #6B7280; margin: 0;">
        If you didn't request this reactivation, please contact us immediately to protect your account security.
      </p>
    `);

    return this.sendMail(to, 'Account Reactivated - BeeSeek', html);
  }

  async sendVerificationApproved(to: string, name: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Identity Verified!</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Your NIN verification has been <strong style="color: #16A34A;">approved</strong>. Your identity is now confirmed on BeeSeek.
      </p>
      <div style="background-color: #F0FDF4; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #BBF7D0;">
        <p style="font-size: 14px; color: #4B5563; margin: 0;">
          You now have full access to all platform features. Your verified badge will be visible to clients, helping you stand out on the platform.
        </p>
      </div>
    `);
    return this.sendMail(to, 'NIN Verification Approved - BeeSeek', html);
  }

  async sendVerificationRejected(to: string, name: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Verification Update</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Unfortunately, your NIN verification has been <strong style="color: #DC2626;">rejected</strong>. This may be due to incomplete or incorrect information.
      </p>
      <div style="background-color: #FEF2F2; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #FECACA;">
        <p style="font-size: 14px; color: #4B5563; margin: 0;">
          Please review and resubmit your NIN details through the app. Make sure your NIN number matches your registered name exactly.
        </p>
      </div>
    `);
    return this.sendMail(to, 'NIN Verification Update - BeeSeek', html);
  }
}
