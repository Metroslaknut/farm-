/**
 * Integration point for email / SMS providers. Real providers (SES, SendGrid, Twilio, …) implement
 * `Notifier` and are passed to `createApp`. Nothing here sends real messages.
 */
export type NotificationTemplate = 'verify_email' | 'verify_phone' | 'password_reset';

export interface Notification {
  channel: 'email' | 'sms';
  to: string;
  template: NotificationTemplate;
  /** One-time secret to deliver: a URL token (email/reset) or a 6-digit code (phone). */
  secret: string;
}

export interface Notifier {
  send(notification: Notification): Promise<void>;
}

/** Development: prints messages (including the secret) to the console. */
export class ConsoleNotifier implements Notifier {
  async send(n: Notification): Promise<void> {
    console.log(`[notify:dev] ${n.channel} → ${n.to} (${n.template}): ${n.secret}`);
  }
}

/** Production default until a provider is wired: drops messages, never logs secrets. */
export class UnconfiguredNotifier implements Notifier {
  async send(n: Notification): Promise<void> {
    console.warn(`[notify] no provider configured; dropped ${n.template} ${n.channel} message`);
  }
}

/** Tests: captures messages. */
export class InMemoryNotifier implements Notifier {
  readonly sent: Notification[] = [];
  async send(n: Notification): Promise<void> {
    this.sent.push(n);
  }
  last(template: NotificationTemplate): Notification | undefined {
    return [...this.sent].reverse().find((n) => n.template === template);
  }
}
