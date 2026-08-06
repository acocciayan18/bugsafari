import nodemailer, { type Transporter } from 'nodemailer';
import { maskEmail } from './authValidation.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[EMAIL]');

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

// Brevo HTTP API — the PRIMARY transport when set. It sends over HTTPS/443, which
// bypasses the outbound-SMTP egress blocks (e.g. GCP blocks 25/465/587) that make the
// nodemailer path time out. SMTP stays the fallback for hosts that allow it.
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

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

// Email is configured when EITHER transport can send — the Brevo HTTP API key or an
// SMTP password. A config gap is distinct from a send that was attempted and failed.
export function isSmtpConfigured(): boolean {
  return BREVO_API_KEY.length > 0 || SMTP_PASS.length > 0;
}

// Brevo's API wants the sender as {email,name}; SMTP_FROM may be "Name <email>" or bare.
function parseSender(): { email: string; name: string } {
  const match = SMTP_FROM.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || APP_NAME, email: match[2].trim() };
  return { name: APP_NAME, email: SMTP_FROM.trim() };
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
  obsLog.warn('[EMAIL] Neither FRONTEND_URL nor RENDER_EXTERNAL_URL is set in production — email links will point at localhost. Set FRONTEND_URL.');
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
      // Fail fast on a blocked egress port: a filtered SMTP port otherwise hangs the
      // signup request ~2min on nodemailer's defaults before the 502 (stuck-loading UX).
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  return transporter;
}

// Optional startup probe. Non-fatal: logs readiness or the exact SMTP fault so a
// misconfiguration is visible at boot instead of on the first signup.
export async function verifyEmailTransport(): Promise<void> {
  if (!isSmtpConfigured()) {
    obsLog.warn('[EMAIL] Email not configured (no BREVO_API_KEY or SMTP_PASS) — auth emails will not send. Set BREVO_API_KEY (HTTP API, recommended) or SMTP_PASS.');
    return;
  }
  // Brevo API mode: no cheap verify endpoint, so log the resolved transport instead of
  // probing. Takes priority — it is the send path whenever the key is present.
  if (BREVO_API_KEY) {
    const sender = parseSender();
    obsLog.info(`[EMAIL] Transport: Brevo HTTP API (from="${sender.name} <${sender.email}>")`);
    return;
  }
  try {
    await getTransporter().verify();
    obsLog.info(`[EMAIL] SMTP ready: ${SMTP_HOST}:${SMTP_PORT} (secure=${SMTP_SECURE}, user="${SMTP_USER}", from="${SMTP_FROM}")`);
  } catch (error) {
    obsLog.error(`[EMAIL] SMTP verify failed for ${SMTP_HOST}:${SMTP_PORT} (user="${SMTP_USER}"):`, error instanceof Error ? error.message : error);
  }
}

// Send via Brevo's transactional HTTP API over 443. Bounded by AbortController so a
// hung request fails fast like the SMTP path. Never throws — returns an EmailResult.
async function sendViaBrevoApi(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: parseSender(), to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      const message = `Brevo API ${response.status}: ${detail}`;
      obsLog.error(`[EMAIL] Failed to send "${subject.trim()}" to ${maskEmail(to)} via Brevo API: ${message}`);
      return { ok: false, code: 'EMAIL_SEND_FAILED', error: message };
    }
    const body = (await response.json().catch(() => ({}))) as { messageId?: string };
    const messageId = body.messageId ?? 'brevo-accepted';
    obsLog.info(`[EMAIL] Sent "${subject.trim()}" to ${maskEmail(to)} via Brevo API: ${messageId}`);
    return { ok: true, messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    obsLog.error(`[EMAIL] Failed to send "${subject.trim()}" to ${maskEmail(to)} via Brevo API: ${message}`);
    return { ok: false, code: 'EMAIL_SEND_FAILED', error: message };
  } finally {
    clearTimeout(timer);
  }
}

// Send via SMTP (nodemailer). Fallback for hosts that permit outbound SMTP.
async function sendViaSmtp(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  try {
    const info = await getTransporter().sendMail({ from: SMTP_FROM, to, subject, html, text });
    obsLog.info(`[EMAIL] Sent "${subject.trim()}" to ${maskEmail(to)}: ${info.messageId}`);
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    obsLog.error(`[EMAIL] Failed to send "${subject.trim()}" to ${maskEmail(to)}: ${message}`);
    return { ok: false, code: 'EMAIL_SEND_FAILED', error: message };
  }
}

// Core send. Prefers the Brevo HTTP API (egress-safe); falls back to SMTP. Never throws.
async function sendMail(to: string, subject: string, html: string, text: string): Promise<EmailResult> {
  return BREVO_API_KEY ? sendViaBrevoApi(to, subject, html, text) : sendViaSmtp(to, subject, html, text);
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
    obsLog.warn(`[EMAIL] Email not configured — verification link for ${maskEmail(email)}: ${verifyLink}`);
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
    obsLog.warn(`[EMAIL] Email not configured — reset link for ${maskEmail(email)}: ${resetLink}`);
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
