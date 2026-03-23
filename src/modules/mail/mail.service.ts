import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService implements OnModuleInit {
  private resend: Resend;
  private readonly logger = new Logger(MailService.name);
  private readonly fromAddress: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY', '');
    this.fromAddress = this.configService.get(
      'FROM_EMAIL',
      this.configService.get('EMAIL_USER', 'no-reply@beeseek.site'),
    );

    this.resend = new Resend(apiKey);

    this.logger.log(
      `MailService config: provider=Resend (HTTP API), from=${this.fromAddress}, apiKey=${apiKey ? '***SET***' : '!!!MISSING!!!'}`,
    );
  }

  async onModuleInit() {
    // Verify Resend is configured by sending a test API call
    try {
      const apiKey = this.configService.get<string>('RESEND_API_KEY', '');
      if (!apiKey) {
        this.logger.warn('RESEND_API_KEY is not set — emails will NOT be sent');
        return;
      }
      // Quick connectivity check — list domains (lightweight call)
      const { data, error } = await this.resend.domains.list();
      if (error) {
        this.logger.error(`Resend API verification FAILED: ${error.message}`);
      } else {
        const domainNames = data?.data?.map((d: any) => d.name).join(', ') || 'none';
        this.logger.log(`Resend API connected — verified domains: ${domainNames}`);
      }
    } catch (err: any) {
      this.logger.error(`Resend API verification FAILED: ${err.message}`);
    }
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
    this.logger.log(`Attempting to send email to=${to}, subject="${subject}", from=${this.fromAddress}`);
    try {
      const { data, error } = await this.resend.emails.send({
        from: `BeeSeek <${this.fromAddress}>`,
        to: [to],
        subject,
        html,
      });

      if (error) {
        this.logger.error(
          `FAILED to send email to ${to}: ${error.message} | name=${error.name}`,
        );
        throw new Error(error.message);
      }

      this.logger.log(`Email sent successfully: id=${data?.id}`);
      return data;
    } catch (error: any) {
      this.logger.error(
        `FAILED to send email to ${to}: ${error.message}`,
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

  async sendWalletTopUpReceipt(to: string, name: string, data: { amount: string, reference: string, timestamp: string }) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Wallet Top-Up Confirmed</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Your wallet has been successfully credited with the funds from your bank transfer.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Amount Credited</td>
            <td style="padding: 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right;">₦${data.amount}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6B7280; font-size: 14px;">Transaction Reference</td>
            <td style="padding: 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right;">${data.reference}</td>
          </tr>
          <tr>
            <td style="padding: 16px 0 8px 0; color: #6B7280; font-size: 14px; border-top: 1px solid #E5E5E5;">Date and Time</td>
            <td style="padding: 16px 0 8px 0; color: #031745; font-size: 14px; font-weight: 600; text-align: right; border-top: 1px solid #E5E5E5;">${data.timestamp}</td>
          </tr>
        </table>
      </div>

      <p style="font-size: 14px; color: #6B7280; margin: 0;">
        Your wallet balance has been updated instantly and you can now use these funds for bookings and transactions on the BeeSeek platform.
      </p>
    `);

    return this.sendMail(to, 'Wallet Top-Up Receipt - BeeSeek', html);
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

  async sendSupportTicketCreated(to: string, name: string, ticketId: string, subject: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Support Ticket Created</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Your support ticket has been successfully created. Our support team will review your case and respond within 24 hours.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <p style="color: #6B7280; margin: 0; font-size: 14px;">Ticket ID</p>
        <p style="color: #031745; margin: 4px 0 0 0; font-weight: 700; font-size: 16px;">${ticketId.slice(0, 8).toUpperCase()}</p>
        <p style="color: #6B7280; margin: 16px 0 0 0; font-size: 14px;">Subject</p>
        <p style="color: #031745; margin: 4px 0 0 0; font-weight: 600;">${subject}</p>
      </div>

      <p style="font-size: 14px; color: #6B7280; line-height: 1.6; margin: 0;">
        You can track your ticket status in the app or by replying to this email. Your support ticket is important to us and we are committed to a swift resolution.
      </p>
    `);

    return this.sendMail(to, `Support Ticket #${ticketId.slice(0, 8).toUpperCase()} Created`, html);
  }

  async sendSupportTicketAssigned(to: string, name: string, ticketId: string, subject: string, agentName: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Your Ticket Has Been Assigned</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        A support specialist has been assigned to your ticket and will be responding shortly.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <p style="color: #6B7280; margin: 0; font-size: 14px;">Ticket ID</p>
        <p style="color: #031745; margin: 4px 0 0 0; font-weight: 700; font-size: 16px;">${ticketId.slice(0, 8).toUpperCase()}</p>
        <p style="color: #6B7280; margin: 16px 0 0 0; font-size: 14px;">Assigned Specialist</p>
        <p style="color: #031745; margin: 4px 0 0 0; font-weight: 600;">${agentName}</p>
      </div>

      <p style="font-size: 14px; color: #6B7280; margin: 0;">
        Watch for responses in the app or via email. We are working to resolve your issue as quickly as possible.
      </p>
    `);

    return this.sendMail(to, `Ticket #${ticketId.slice(0, 8).toUpperCase()} Assigned to Agent`, html);
  }

  async sendSupportMessageReceived(to: string, name: string, ticketId: string, messagePreview: string) {
    const preview = messagePreview.slice(0, 150) + (messagePreview.length > 150 ? '...' : '');
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">New Response on Your Ticket</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Our support team has sent you a response on your ticket.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <p style="color: #6B7280; margin: 0; font-size: 14px;">Ticket ID</p>
        <p style="color: #031745; margin: 4px 0 16px 0; font-weight: 700;">${ticketId.slice(0, 8).toUpperCase()}</p>
        <p style="color: #6B7280; margin: 0; font-size: 14px;">Message</p>
        <p style="color: #031745; margin: 4px 0 0 0; font-size: 14px; line-height: 1.5; padding-left: 12px; border-left: 3px solid #031745;">${preview}</p>
      </div>

      <p style="font-size: 14px; color: #6B7280; margin: 0;">
        Log into the BeeSeek app to view the complete message and respond to your support ticket.
      </p>
    `);

    return this.sendMail(to, `New Response on Ticket #${ticketId.slice(0, 8).toUpperCase()}`, html);
  }

  async sendSupportTicketResolved(to: string, name: string, ticketId: string, subject: string) {
    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Support Ticket Resolved</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},<br><br>
        Your support ticket has been marked as resolved. We appreciate your patience and feedback.
      </p>

      <div style="background-color: #F8F9FA; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #E5E5E5;">
        <p style="color: #6B7280; margin: 0; font-size: 14px;">Ticket ID</p>
        <p style="color: #031745; margin: 4px 0 0 0; font-weight: 700; font-size: 16px;">${ticketId.slice(0, 8).toUpperCase()}</p>
        <p style="color: #6B7280; margin: 16px 0 0 0; font-size: 14px;">Subject</p>
        <p style="color: #031745; margin: 4px 0 0 0;">${subject}</p>
      </div>

      <p style="font-size: 14px; color: #6B7280; line-height: 1.6; margin: 0;">
        If you have additional issues or need further assistance, you can open a new ticket anytime. Thank you for being part of the BeeSeek community.
      </p>
    `);

    return this.sendMail(to, `Ticket #${ticketId.slice(0, 8).toUpperCase()} Resolved`, html);
  }

  async sendStaleJobAlert(
    to: string,
    name: string,
    role: 'CLIENT' | 'AGENT',
    jobId: string,
    alertType: 'NO_SHOW' | 'STALE_TRANSIT' | 'STALE_WORK',
    message: string,
  ) {
    const alertLabels = {
      NO_SHOW: 'Agent No-Show',
      STALE_TRANSIT: 'Delayed Transit',
      STALE_WORK: 'Extended Duration',
    };

    const alertColors = {
      NO_SHOW: '#DC2626',
      STALE_TRANSIT: '#D97706',
      STALE_WORK: '#2563EB',
    };

    const label = alertLabels[alertType];
    const color = alertColors[alertType];

    const html = this.wrapTemplate(`
      <h1 style="font-size: 24px; font-weight: 700; margin: 0 0 16px 0; color: #031745;">Job Alert: ${label}</h1>
      <p style="font-size: 16px; line-height: 1.5; color: #4B5563; margin: 0 0 24px 0;">
        Hello ${name},
      </p>

      <div style="background-color: #FEF2F2; border-radius: 12px; padding: 24px; margin-bottom: 24px; border-left: 4px solid ${color};">
        <div style="display: inline-block; padding: 4px 12px; border-radius: 8px; background-color: ${color}; color: white; font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 12px;">
          ${label}
        </div>
        <p style="color: #6B7280; margin: 0; font-size: 14px;">Job Reference</p>
        <p style="color: #031745; margin: 4px 0 16px 0; font-weight: 700; font-family: monospace;">${jobId.slice(0, 8).toUpperCase()}</p>
        <p style="color: #031745; margin: 0; font-size: 14px; line-height: 1.6;">${message}</p>
      </div>

      ${role === 'CLIENT' ? `
      <p style="font-size: 14px; color: #6B7280; line-height: 1.6; margin: 0;">
        If you need immediate assistance, please open a support ticket in the app or email us at <strong>support@beeseek.site</strong>.
      </p>
      ` : `
      <p style="font-size: 14px; color: #6B7280; line-height: 1.6; margin: 0;">
        If this was due to an emergency, please contact support immediately to explain your situation. Repeated infractions may result in enforcement actions per our <strong>Service Level & Infraction Policy</strong>.
      </p>
      `}
    `);

    return this.sendMail(to, `Job Alert: ${label} — #${jobId.slice(0, 8).toUpperCase()}`, html);
  }
}
