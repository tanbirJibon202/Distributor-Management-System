import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import httpStatus from 'http-status';
import nodemailer, { type Transporter } from 'nodemailer';
import config from '../config/index.js';
import { AppError } from '../utils/AppError.js';

export type EmailTemplate =
  // Requested by the recipient themselves.
  | 'forgot-password'
  | 'reset-password-success'
  | 'registration-otp'
  | 'order-invoice'
  // Sent because someone else acted on the recipient's account or work, so the
  // recipient learns about it without having to go looking.
  | 'staff-welcome'
  | 'order-status-changed'
  | 'account-role-changed';

type SendEmailInput = {
  to: string;
  subject: string;
  template: EmailTemplate;
  data: Record<string, unknown>;
  attachments?: { filename: string; content: Buffer }[];
};

// Resolved from this module's own location, not process.cwd(). The templates
// are copied next to the compiled output at build time, so this holds whether
// the app runs from src via tsx or from dist in production — and it does not
// care what directory the process was started in.
const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

const isConfigured = () => Boolean(config.smtp_host && config.smtp_user && config.smtp_password);

// Built per send rather than cached. Without pooling a transport is a cheap
// object that opens its connection at send time, so caching one buys nothing
// — and a module-level instance is a hidden global: once created it survives
// configuration changes and makes the transport impossible to substitute.
const getTransporter = (): Transporter => {
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      'Email is not configured on this server. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD.',
    );
  }

  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    // 465 is implicit TLS; 587 and 2525 start plaintext and upgrade via
    // STARTTLS, which nodemailer does on its own when secure is false.
    secure: config.smtp_port === 465,
    auth: { user: config.smtp_user, pass: config.smtp_password },
  });
};

/**
 * Renders a template and sends it.
 *
 * Always call this outside a database transaction. SMTP is a network round trip
 * measured in seconds; holding row locks across it is how a slow mail server
 * turns into database contention.
 */
export const sendEmail = async ({ to, subject, template, data, attachments }: SendEmailInput) => {
  const mailer = getTransporter();
  const html = await ejs.renderFile(path.join(TEMPLATE_DIR, `${template}.ejs`), data);

  await mailer.sendMail({
    from: config.email_sender,
    to,
    subject,
    html,
    ...(attachments ? { attachments } : {}),
  });
};

/**
 * Sends without letting a mail failure propagate.
 *
 * For mail that accompanies an action rather than being the action: the order
 * is placed and the invoice exists whether or not the copy reaches an inbox, so
 * a bounced send must not turn a successful request into an error. Password
 * reset is the opposite case and uses sendEmail directly — there, if the mail
 * did not go out, the caller genuinely failed.
 */
export const sendEmailSafely = async (input: SendEmailInput) => {
  try {
    await sendEmail(input);
    return true;
  } catch (error) {
    console.error(
      `Email "${input.template}" to ${input.to} failed:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
};

export const isEmailConfigured = isConfigured;
