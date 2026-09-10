import nodemailer, { Transporter, SentMessageInfo, TestAccount } from 'nodemailer';
import { env } from '../config/env';
import { EmailSenderRecord } from '../config/db';

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
  senderEmail?: string;
  senderName?: string;
}

class MailerService {
  private transporter: Transporter | null = null;
  private etherealAccount: TestAccount | null = null;
  private initializing: Promise<void> | null = null;
  private senderTransporters = new Map<string, Transporter>();


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

  private async getTransporterForSender(sender?: EmailSenderRecord | null): Promise<Transporter> {
    if (this.initializing) {
      await this.initializing;
    }

    if (sender && sender.smtp_host && sender.smtp_user && sender.smtp_pass) {
      const cached = this.senderTransporters.get(sender.id);
      if (cached) return cached;

      const customTransporter = nodemailer.createTransport({
        host: sender.smtp_host,
        port: sender.smtp_port || 587,
        secure: sender.smtp_port === 465,
        auth: {
          user: sender.smtp_user,
          pass: sender.smtp_pass,
        },
      });
      this.senderTransporters.set(sender.id, customTransporter);
      return customTransporter;
    }

    if (!this.transporter) {
      throw new Error('Default mail transporter is not ready.');
    }
    return this.transporter;
  }

  public async sendMailFromSender(
    sender: EmailSenderRecord | null | undefined,
    options: SendEmailOptions
  ): Promise<SendEmailResult> {
    const transporter = await this.getTransporterForSender(sender);

    const fromHeader = sender
      ? `"${sender.name}" <${sender.email}>`
      : options.from ||
        process.env.SMTP_FROM ||
        (this.etherealAccount
          ? `"ReachInbox Scheduler" <${this.etherealAccount.user}>`
          : '"ReachInbox Scheduler" <no-reply@reachinbox.ai>');

    const isHtml = options.body.includes('<') && options.body.includes('>');

    const info: SentMessageInfo = await transporter.sendMail({
      from: fromHeader,
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
      senderEmail: sender?.email,
      senderName: sender?.name,
    };
  }

  public async provisionTestAccount(name: string): Promise<{
    name: string;
    email: string;
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_pass: string;
  }> {
    console.log(`📬 Provisioning fresh dynamic Ethereal test account for sender: ${name}...`);
    const testAccount = await nodemailer.createTestAccount();
    return {
      name,
      email: testAccount.user,
      smtp_host: 'smtp.ethereal.email',
      smtp_port: 587,
      smtp_user: testAccount.user,
      smtp_pass: testAccount.pass,
    };
  }

  public async sendMail(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.sendMailFromSender(null, options);
  }

  public getAccountInfo() {
    return {
      type: this.etherealAccount ? 'ethereal' : 'custom',
      user: this.etherealAccount ? this.etherealAccount.user : process.env.SMTP_USER || 'configured',
      configuredSendersCount: this.senderTransporters.size,
    };
  }
}

export const mailerService = new MailerService();
