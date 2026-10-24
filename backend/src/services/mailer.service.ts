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
      const emailProvider = env.EMAIL_PROVIDER;

      // 1. Explicit Brevo SMTP provider (e.g. for Render Free on port 2525)
      if (emailProvider === 'brevo') {
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
          throw new Error(
            `EMAIL_PROVIDER is configured as 'brevo', but required credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are missing.`
          );
        }

        const defaultPort = process.env.SMTP_HOST.includes('brevo.com') ? 2525 : 587;
        const port = Number(process.env.SMTP_PORT) || defaultPort;

        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port,
          secure: process.env.SMTP_SECURE === 'true' || port === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        });
        console.log(`📧 Configured Brevo SMTP email transporter (${process.env.SMTP_HOST}:${port}) with pooled connections`);

        this.transporter
          .verify()
          .then(() => console.log(`✅ [SMTP] Brevo relay connection verified (${process.env.SMTP_HOST}:${port})`))
          .catch((err) => console.warn(`⚠️ [SMTP] Brevo relay verification warning: ${err.message}`));

        return;
      }

      // Assignment Primary / Default: Ethereal Fake SMTP
      // Case A: Statically configured Ethereal credentials (ETHEREAL_USER/PASS or SMTP_HOST=smtp.ethereal.email)
      const etherealUser = process.env.ETHEREAL_USER || (process.env.SMTP_HOST?.includes('ethereal') ? process.env.SMTP_USER : undefined);
      const etherealPass = process.env.ETHEREAL_PASS || (process.env.SMTP_HOST?.includes('ethereal') ? process.env.SMTP_PASS : undefined);

      if (etherealUser && etherealPass) {
        console.log(`📬 Configuring Ethereal SMTP with configured credentials (${etherealUser})...`);
        this.etherealAccount = {
          user: etherealUser,
          pass: etherealPass,
          smtp: { host: 'smtp.ethereal.email', port: 587, secure: false },
          imap: { host: 'imap.ethereal.email', port: 993, secure: true },
          pop3: { host: 'pop3.ethereal.email', port: 995, secure: true },
          web: 'https://ethereal.email',
        };
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: etherealUser,
            pass: etherealPass,
          },
          pool: true,
          maxConnections: 5,
          maxMessages: 100,
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        });

        console.log('=========================================');
        console.log('🎉 Ethereal Fake SMTP Active (Static Credentials):');
        console.log(`👤 User: ${this.etherealAccount.user}`);
        console.log('🔗 Email preview URLs will be generated automatically for every sent message');
        console.log('=========================================');
        return;
      }

      // Case B: Zero-config automatic dynamic Ethereal test account (Nodemailer supported)
      console.log('📬 Provisioning dynamic Ethereal Test Email Account for testing...');
      this.etherealAccount = await nodemailer.createTestAccount();

      this.transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: this.etherealAccount.user,
          pass: this.etherealAccount.pass,
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
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

    const isBrevo = env.EMAIL_PROVIDER === 'brevo';
    const verifiedFrom = process.env.SMTP_FROM || process.env.SMTP_USER;

    let fromHeader: string;
    let replyTo: string | undefined = undefined;

    if (sender) {
      if (sender.smtp_host && sender.smtp_user) {
        // Sender has individual custom SMTP configuration
        fromHeader = `"${sender.name}" <${sender.email}>`;
      } else if (isBrevo && verifiedFrom) {
        // Shared relay (e.g. Brevo) requires the From address to match the verified account email.
        // Maintain sender display name and route replies back to sender.email via Reply-To.
        fromHeader = `"${sender.name}" <${verifiedFrom}>`;
        replyTo = sender.email;
      } else {
        fromHeader = `"${sender.name}" <${sender.email}>`;
      }
    } else {
      fromHeader = options.from ||
        (isBrevo && verifiedFrom ? verifiedFrom : undefined) ||
        (this.etherealAccount
          ? `"ReachInbox Scheduler" <${this.etherealAccount.user}>`
          : '"ReachInbox Scheduler" <scheduler@ethereal.email>');
    }

    const isHtml = options.body.includes('<') && options.body.includes('>');

    const info: SentMessageInfo = await transporter.sendMail({
      from: fromHeader,
      to: options.to,
      subject: options.subject,
      text: isHtml ? undefined : options.body,
      html: isHtml ? options.body : undefined,
      replyTo,
    });

    // Preview URL only generated for Ethereal sandbox; Brevo delivers real emails (no fake URL created)
    const testUrl = isBrevo ? null : nodemailer.getTestMessageUrl(info);
    const previewUrl = testUrl ? String(testUrl) : null;

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

  public async ensureReady(): Promise<void> {
    if (this.initializing) {
      await this.initializing;
    }
  }

  public async sendMail(options: SendEmailOptions): Promise<SendEmailResult> {
    return this.sendMailFromSender(null, options);
  }

  public getAccountInfo() {
    const isBrevo = env.EMAIL_PROVIDER === 'brevo';
    return {
      type: isBrevo ? 'brevo' : 'ethereal',
      user: isBrevo
        ? process.env.SMTP_USER || 'configured'
        : this.etherealAccount
        ? this.etherealAccount.user
        : 'provisioning',
      configuredSendersCount: this.senderTransporters.size,
    };
  }
}

export const mailerService = new MailerService();
