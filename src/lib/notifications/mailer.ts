/**
 * メール送信の自前抽象層。
 * EmailSender インターフェースの裏に実装を隠すことで、Resend から
 * Nodemailer / SES へいつでも差し替えられる（特定SaaSにロックインしない）。
 * 送信は専用サブドメイン(NOTIFY_FROM_EMAIL)から行い、本業ドメインと分離する。
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSendResult {
  ok: boolean;
  id?: string;
  dryRun?: boolean;
  error?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/** RESEND_API_KEY 未設定時のフォールバック。送信せずログのみ。 */
export class DryRunEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    console.log(
      `[mailer:dry-run] to=${maskEmailForLog(message.to)} subject=${message.subject}`,
    );
    return { ok: true, dryRun: true };
  }
}

/** Resend 実装（HTTP API を直接叩く。SDK 依存を持たない）。 */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return {
          ok: false,
          error: `resend ${res.status}: ${maskEmailForLog(body).slice(0, 300)}`,
        };
      }
      const data = (await res.json()) as { id?: string };
      return { ok: true, id: data.id };
    } catch (err) {
      return { ok: false, error: maskEmailForLog((err as Error).message) };
    }
  }
}

/** 環境変数に応じて適切な EmailSender を返すファクトリ。 */
export function createEmailSender(): EmailSender {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return new DryRunEmailSender();
  const from = process.env.NOTIFY_FROM_EMAIL?.trim();
  if (!from) {
    throw new Error(
      "RESEND_API_KEY を設定する場合は NOTIFY_FROM_EMAIL も設定してください",
    );
  }
  return new ResendEmailSender(apiKey, from);
}

export function maskEmailForLog(value: string): string {
  return value.replace(
    /([A-Z0-9._%+-])([A-Z0-9._%+-]*)(@[A-Z0-9.-]+\.[A-Z]{2,})/gi,
    (_match, first: string, _rest: string, domain: string) =>
      `${first}***${domain}`,
  );
}
