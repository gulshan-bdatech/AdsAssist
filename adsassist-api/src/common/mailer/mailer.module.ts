import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

/** SMTP mail. When SMTP is not configured, `configured` is false and sends are skipped. */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.from = config.get<string>('SMTP_FROM') || config.get<string>('SMTP_USER') || 'AdsAssist <no-reply@localhost>';
    this.transport = host
      ? nodemailer.createTransport({
          host,
          port: config.get<number>('SMTP_PORT') ?? 587,
          secure: (config.get<number>('SMTP_PORT') ?? 587) === 465,
          auth: config.get('SMTP_USER') ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') } : undefined,
        })
      : null;
  }

  get configured() {
    return this.transport !== null;
  }

  async send(to: string[], subject: string, html: string, text: string): Promise<boolean> {
    if (!this.transport || !to.length) return false;
    try {
      await this.transport.sendMail({ from: this.from, to: to.join(', '), subject, html, text });
      return true;
    } catch (e) {
      this.logger.error(`Email "${subject}" failed: ${(e as Error).message}`);
      return false;
    }
  }
}

@Global()
@Module({ providers: [MailerService], exports: [MailerService] })
export class MailerModule {}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
