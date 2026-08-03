import nodemailer, { type Transporter } from 'nodemailer';
import { maskEmail } from './authValidation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Email service. Single owner of SMTP transport, sender identity, link building
// and delivery for every operator-auth email (verification, password reset).
// Tuned for Resend SMTP on Render: configurable 465/SSL or 587/STARTTLS ports.
// Every send returns a structured EmailResult and never throws, so a failed
// dispatch degrades to an error the caller can surface — it never crashes a route.
// ─────────────────────────────────────────────────────────────────────────────

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.resend.com';
const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10) || 587;
// 465 is implicit TLS (secure). 587/2587 start plaintext then STARTTLS. Honor an
// explicit SMTP_SECURE, else infer from the port so a single SMTP_PORT change flips
// the mode correctly.
const SMTP_SECURE = process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : SMTP_PORT === 465;
// Resend authenticates with the literal username "resend" and the API key as password.
const SMTP_USER = process.env.SMTP_USER || 'resend';
const SMTP_PASS = process.env.SMTP_PASS || '';

export const APP_NAME = process.env.APP_NAME || 'BugSafari';
// Resend's shared onboarding@resend.dev works without domain verification, so it is a
// safe development default; production sets SMTP_FROM to a verified-domain sender.
const SMTP_FROM = process.env.SMTP_FROM || `${APP_NAME} <onboarding@resend.dev>`;

// Link lifetimes (ms), configurable. Reset default 1h, verification default 24h.
export const RESET_TOKEN_TTL_MS = Number.parseInt(process.env.RESET_TOKEN_TTL_MS || '3600000', 10) || 3600000;
export const EMAIL_VERIFICATION_TTL_MS = Number.parseInt(process.env.EMAIL_VERIFICATION_TTL_MS || '86400000', 10) || 86400000;

export type EmailErrorCode = 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SEND_FAILED';
export type EmailResult =
  | { ok: true; messageId: string }
  | { ok: false; code: EmailErrorCode; error: string };

// A missing SMTP password (Resend API key) is a config problem, distinct from a
// send that was attempted and failed — the two are surfaced differently.
export function isSmtpConfigured(): boolean {
  return SMTP_PASS.length > 0;
}

// A dev machine with no SMTP configured should not be blocked: the link is logged
// and the flow proceeds. Production never gets that pass — an unsendable email there
// is a hard failure so no false success reaches the user.
export function deliveredOrDevFallback(result: EmailResult): boolean {
  return result.ok || (result.code === 'EMAIL_NOT_CONFIGURED' && process.env.NODE_ENV !== 'production');
}

// Public base URL for links in emails. Never localhost in production: prefer the
// explicit FRONTEND_URL, then Render's injected RENDER_EXTERNAL_URL. Trailing
// slashes are normalized so `${base}/verify-email` never doubles up.
export function resolveBaseUrl(): string {
  const raw = process.env.FRONTEND_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173';
  return raw.replace(/\/+$/, '');
}

if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL && !process.env.RENDER_EXTERNAL_URL) {
  console.warn('[EMAIL] Neither FRONTEND_URL nor RENDER_EXTERNAL_URL is set in production — email links will point at localhost. Set FRONTEND_URL.');
}

// Render a duration in ms as the coarse human string used in email copy. Floor
// (not round) to hours so a 30-minute TTL never reads as "1 hour".
export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return hours === 1 ? '1 hour' : `${hours} hours`;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

let transporter: Transporter | null = null;
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      // Force STARTTLS on the non-secure ports so credentials never cross in plaintext.
      requireTLS: !SMTP_SECURE,
      auth: SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// Optional startup probe. Non-fatal: logs readiness or the exact SMTP fault so a
// misconfiguration is visible at boot instead of on the first signup.
export async function verifyEmailTransport(): Promise<void> {
  if (!isSmtpConfigured()) {
    console.warn('[EMAIL] SMTP not configured (SMTP_PASS empty) — auth emails will not send. Set SMTP_PASS to your Resend API key.');
    return;
  }
  try {
    await getTransporter().verify();
    console.log(`[EMAIL] SMTP ready: ${SMTP_HOST}:${SMTP_PORT} (secure=${SMTP_SECURE}, user="${SMTP_USER}", from="${SMTP_FROM}")`);
  } catch (error) {
    console.error(`[EMAIL] SMTP verify failed for ${SMTP_HOST}:${SMTP_PORT} (user="${SMTP_USER}"):`, error instanceof Error ? error.message : error);
  }
}

// Core send. Never throws — every outcome is a structured EmailResult.
async function sendMail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  try {
    const info = await getTransporter().sendMail({ from: SMTP_FROM, to, subject, html, text });
    console.log(`[EMAIL] Sent "${subject.trim()}" to ${maskEmail(to)}: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[EMAIL] Failed to send "${subject.trim()}" to ${maskEmail(to)}: ${message}`);
    return { ok: false, code: 'EMAIL_SEND_FAILED', error: message };
  }
}

// Dark-header card shared by both operator emails so they read as one brand.
function renderEmail(heading: string, intro: string, cta: string, link: string, expiresIn: string, disclaimer: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">${APP_NAME}</h1>
              <p style="margin: 10px 0 0 0; color: #94a3b8; font-size: 14px;">${heading}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 20px; font-weight: 600;">${heading}</h2>
              <p style="margin: 0 0 20px 0; color: #64748b; font-size: 15px; line-height: 1.6;">${intro}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 25px 0;">
                    <a href="${link}" style="display: inline-block; background: #1e293b; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">${cta}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 25px 0 15px 0; color: #64748b; font-size: 13px;">Or copy and paste this link in your browser:</p>
              <p style="margin: 0; word-break: break-all;"><a href="${link}" style="color: #3b82f6; font-size: 13px;">${link}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding: 25px 30px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">
                This link will expire in ${expiresIn}.<br>
                ${disclaimer}
              </p>
            </td>
          </tr>
        </table>
        <p style="margin: 25px 0 0 0; color: #94a3b8; font-size: 12px; text-align: center;">${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Send the signup verification email. Returns EmailResult; on an unconfigured SMTP
// the link is logged so local dev still works (see deliveredOrDevFallback).
export async function sendVerificationEmail(email: string, verifyToken: string): Promise<EmailResult> {
  const verifyLink = `${resolveBaseUrl()}/verify-email?token=${verifyToken}&email=${encodeURIComponent(email)}`;
  const expiresIn = formatDuration(EMAIL_VERIFICATION_TTL_MS);

  if (!isSmtpConfigured()) {
    console.warn(`[EMAIL] SMTP not configured — verification link for ${maskEmail(email)}: ${verifyLink}`);
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED', error: 'SMTP not configured' };
  }

  const html = renderEmail(
    'Verify your email',
    'Thanks for signing up. Confirm this email address to activate your account and sign in:',
    'Verify Email',
    verifyLink,
    expiresIn,
    "If you didn't create an account, please ignore this email.",
  );
  const text = `${APP_NAME} - Verify your email\n\nConfirm your account by opening the link below:\n${verifyLink}\n\nThis link will expire in ${expiresIn}.\n\nIf you didn't create an account, please ignore this email.`;
  return sendMail(email, `Verify your email - ${APP_NAME}`, html, text);
}

// Send the password reset email. Same EmailResult / dev-fallback contract.
export async function sendPasswordResetEmail(email: string, resetToken: string): Promise<EmailResult> {
  const resetLink = `${resolveBaseUrl()}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;
  const expiresIn = formatDuration(RESET_TOKEN_TTL_MS);

  if (!isSmtpConfigured()) {
    console.warn(`[EMAIL] SMTP not configured — reset link for ${maskEmail(email)}: ${resetLink}`);
    return { ok: false, code: 'EMAIL_NOT_CONFIGURED', error: 'SMTP not configured' };
  }

  const html = renderEmail(
    'Password Reset',
    'We received a request to reset your password. Click the button below to create a new password:',
    'Reset Password',
    resetLink,
    expiresIn,
    "If you didn't request this, please ignore this email.",
  );
  const text = `${APP_NAME} - Password Reset\n\nCreate a new password by opening the link below:\n${resetLink}\n\nThis link will expire in ${expiresIn}.\n\nIf you didn't request this, please ignore this email.`;
  return sendMail(email, `Password Reset Request - ${APP_NAME}`, html, text);
}
