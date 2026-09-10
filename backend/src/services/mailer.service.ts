import nodemailer, { Transporter, SentMessageInfo, TestAccount } from 'nodemailer';
import { env } from '../config/env';

export interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | null;
  accepted: string[];
}

class MailerService {
  private transporter: Transporter | null = null;
  private etherealAccount: TestAccount | null = null;
  private initializing: Promise<void> | null = null;


  constructor() {
    this.initializing = this.initTransporter();
  }

  private async initTransporter(): Promise<void> {
    try {
      // Check if custom SMTP is defined in env
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });
        console.log('📧 Configured custom SMTP email transporter');
        return;
      }

      // Default: Create Ethereal test account for instant sandbox email testing
      console.log('📬 Creating Ethereal Test Email Account for testing...');
      this.etherealAccount = await nodemailer.createTestAccount();
      
      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: this.etherealAccount.user,
          pass: this.etherealAccount.pass,
        },
      });

      console.log('=========================================');
      console.log('🎉 Ethereal Test Account Provisioned:');
      console.log(`👤 User: ${this.etherealAccount.user}`);
      console.log('🔗 Email preview URLs will be generated automatically for every sent message');
      console.log('=========================================');
    } catch (error: any) {
      console.error('❌ Failed to initialize email transporter:', error.message);
      // Fallback pseudo-transport for mock simulation if network blocks ethereal
      this.transporter = nodemailer.createTransport({
        streamTransport: true,
        newline: 'windows',
      });
      console.log('⚠️ Using simulated stream transport fallback');
    }
  }

  public async sendMail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (this.initializing) {
      await this.initializing;
    }

    if (!this.transporter) {
      throw new Error('Mail transporter is not ready.');
    }

    const defaultFrom =
      options.from ||
      process.env.SMTP_FROM ||
      (this.etherealAccount
        ? `"ReachInbox Scheduler" <${this.etherealAccount.user}>`
        : '"ReachInbox Scheduler" <no-reply@reachinbox.ai>');

    const isHtml = options.body.includes('<') && options.body.includes('>');

    const info: SentMessageInfo = await this.transporter.sendMail({
      from: defaultFrom,
      to: options.to,
      subject: options.subject,
      text: isHtml ? undefined : options.body,
      html: isHtml ? options.body : undefined,
    });

    const previewUrl = nodemailer.getTestMessageUrl(info) || null;

    return {
      messageId: info.messageId,
      previewUrl: previewUrl ? String(previewUrl) : null,
      accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [options.to],
    };
  }

  public getAccountInfo() {
    return {
      type: this.etherealAccount ? 'ethereal' : 'custom',
      user: this.etherealAccount ? this.etherealAccount.user : process.env.SMTP_USER || 'configured',
    };
  }
}

export const mailerService = new MailerService();
