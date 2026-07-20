import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { sanitizeString, validatePasswordComplexity } from './authValidation.js';
import { revokeAllForUser } from './refreshTokenService.js';

// Email transporter configuration
// Using environment variables for SMTP settings
const emailConfig = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
};

const APP_NAME = process.env.APP_NAME || 'BugSafari';
const APP_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Create nodemailer transporter
 */
function createEmailTransporter() {
  return nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.auth.user ? emailConfig.auth : undefined,
  });
}

/**
 * Send password reset email
 */
async function sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
  const resetLink = `${APP_URL}/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

  const mailOptions = {
    from: `"${APP_NAME}" <${process.env.SMTP_USER || 'noreply@bugsafari.com'}>`,
    to: email,
    subject: ' Password Reset Request - BugSafari',
    html: `
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
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 40px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">${APP_NAME}</h1>
              <p style="margin: 10px 0 0 0; color: #94a3b8; font-size: 14px;">Password Reset</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #1e293b; font-size: 20px; font-weight: 600;">Forgot your password?</h2>
              <p style="margin: 0 0 20px 0; color: #64748b; font-size: 15px; line-height: 1.6;">
                We received a request to reset your password. Click the button below to create a new password:
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding: 25px 0;">
                    <a href="${resetLink}" style="display: inline-block; background: #1e293b; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 25px 0 15px 0; color: #64748b; font-size: 13px;">
                Or copy and paste this link in your browser:
              </p>
              <p style="margin: 0; word-break: break-all;">
                <a href="${resetLink}" style="color: #3b82f6; font-size: 13px;">${resetLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 25px 30px; background: #f8fafc; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px; text-align: center;">
                This link will expire in 1 hour.<br>
                If you didn't request this, please ignore this email.
              </p>
            </td>
          </tr>
        </table>

        <p style="margin: 25px 0 0 0; color: #94a3b8; font-size: 12px; text-align: center;">
           ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
    text: `
${APP_NAME} - Password Reset

We received a request to reset your password.

Click the link below to create a new password:
${resetLink}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.
    `,
  };

  try {
    const transporter = createEmailTransporter();

    // Check if SMTP is configured
    if (!emailConfig.auth.user) {
      console.log(`[EMAIL] SMTP not configured. Reset link would be: ${resetLink}`);
      return false;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Password reset email sent to ${email}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`[EMAIL] Failed to send password reset email:`, error);
    return false;
  }
}

/**
 * Generate a secure reset token
 */
function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * POST /api/auth/forgot-password
 * Request a password reset - generates token and shows reset link
 */
export async function handleForgotPassword(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email } = request.body;

    // Validate and sanitize email
    const sanitizedEmail = sanitizeString(email, 'email');

    if (!sanitizedEmail) {
      response.status(400).json({
        error: 'Email is required',
      });
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();

    // Additional validation
    if (trimmedEmail.length < 5 || !trimmedEmail.includes('@')) {
      response.status(400).json({
        error: 'Please enter a valid email address',
      });
      return;
    }

    // Find user by email
    const user = await UserModel.findOne({ email: trimmedEmail });

    // ALWAYS return success to prevent email enumeration attacks
    // But generate the token if user exists
    if (user) {
      // Generate reset token. The plaintext token is only ever sent to the user
      // (email/link) - the DB stores a bcrypt hash of it, same as passwords, so a
      // DB read/leak alone can't be replayed to reset an account's password.
      const resetToken = generateResetToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      user.resetPasswordToken = await bcrypt.hash(resetToken, 10);
      user.resetPasswordExpires = resetExpires;
      await user.save();

      // The plaintext token leaves the server only via the reset email.
      console.log(`[FORGOT PASSWORD] Reset requested for: ${trimmedEmail} (expires in 1 hour)`);
      await sendPasswordResetEmail(trimmedEmail, resetToken);

      response.json({
        ok: true,
        message: 'If an account exists with that email, a password reset link has been sent.',
      });
    } else {
      // User doesn't exist - still return success to prevent enumeration
      console.log(`[FORGOT PASSWORD] No user found for email: ${trimmedEmail}`);
      response.json({
        ok: true,
        message: 'If an account exists with that email, a password reset link has been sent.',
      });
    }
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/reset-password
 * Reset password using the token from forgot-password
 */
export async function handleResetPassword(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, token, newPassword } = request.body;

    // Validate inputs
    const sanitizedEmail = sanitizeString(email, 'email');
    const sanitizedToken = sanitizeString(token, 'token');
    const sanitizedPassword = sanitizeString(newPassword, 'newPassword');

    if (!sanitizedEmail || !sanitizedToken || !sanitizedPassword) {
      response.status(400).json({
        error: 'Email, token, and new password are required',
      });
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();
    const trimmedToken = sanitizedToken.trim();
    const trimmedPassword = sanitizedPassword;

    // Validate password complexity
    const complexityError = validatePasswordComplexity(trimmedPassword);
    if (complexityError) {
      response.status(400).json({
        error: 'Security validation failure: New password does not meet complexity requirements.',
      });
      return;
    }

    // Find user by email
    const user = await UserModel.findOne({ email: trimmedEmail });

    if (!user) {
      response.status(400).json({
        error: 'Invalid or expired reset token',
      });
      return;
    }

    // Verify token matches (hash compare, not raw !==) and hasn't expired
    const tokenMatches = user.resetPasswordToken
      ? await bcrypt.compare(trimmedToken, user.resetPasswordToken)
      : false;
    if (
      !tokenMatches ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires < new Date()
    ) {
      console.warn(`[RESET PASSWORD] Invalid or expired token for: ${trimmedEmail}`);
      response.status(400).json({
        error: 'Invalid or expired reset token',
      });
      return;
    }

    // Update password (will be hashed by pre-save hook)
    user.password = trimmedPassword;

    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    // A password change must terminate every session established with the old
    // one. Outstanding access tokens remain valid until their short TTL lapses.
    const revoked = await revokeAllForUser(user._id.toString(), 'password-reset');

    console.log(`[RESET PASSWORD] Password successfully reset for: ${trimmedEmail} (${revoked} session(s) revoked)`);

    response.json({
      ok: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (err) {
    next(err);
  }
}
