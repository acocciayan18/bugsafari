import type { Express, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { AUTH_CONFIG, verifyTokenSync, type AuthPayload } from './authConfig.js';

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
    subject: '🔐 Password Reset Request - BugSafari',
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
          © ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.
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

// Use centralized JWT config - no duplication needed
const JWT_EXPIRES_IN = AUTH_CONFIG.JWT_EXPIRES_IN;

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * Server-side password complexity validation - mirrors frontend regex criteria
 * Defense-in-Depth: Validates against 4 regex checks applied on frontend client
 * Uses regex pattern lookup approach for string complexity verification
 * Returns true if password meets ALL complexity requirements
 */
const PASSWORD_COMPLEXITY_PATTERNS: { name: string; regex: RegExp; errorMessage: string }[] = [
  {
    name: 'minLength',
    regex: /^.{8,}$/,
    errorMessage: 'Password must be at least 8 characters long',
  },
  {
    name: 'uppercase',
    regex: /[A-Z]/,
    errorMessage: 'Password must contain at least one uppercase letter (A-Z)',
  },
  {
    name: 'number',
    regex: /[0-9]/,
    errorMessage: 'Password must contain at least one numeric character (0-9)',
  },
  {
    name: 'specialChar',
    regex: /[^A-Za-z0-9]/,
    errorMessage: 'Password must contain at least one special character',
  },
];

/**
 * Validate password using regex pattern lookup approach
 * Returns the error message if validation fails, null if valid
 */
function validatePasswordComplexity(password: string): string | null {
  for (const pattern of PASSWORD_COMPLEXITY_PATTERNS) {
    if (!pattern.regex.test(password)) {
      return pattern.errorMessage;
    }
  }
  return null;
}

/**
 * Helper: Validate string input and prevent NoSQL injection attacks
 * Ensures input is a plain string, not an object like {"$gt": ""}
 */
function sanitizeString(value: unknown, fieldName: string): string | null {
  // Check if value is a primitive string
  if (typeof value !== 'string') {
    console.error(`[Auth] ${fieldName} is not a valid string type:`, typeof value);
    return null;
  }

  // Check for empty or whitespace-only strings
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    console.error(`[Auth] ${fieldName} is empty or whitespace-only`);
    return null;
  }

  // Check for potential NoSQL injection patterns
  if (value.includes('$') && value.match(/\$\w+/)) {
    console.error(`[Auth] Potential NoSQL injection in ${fieldName}:`, value);
    return null;
  }

  return value;
}

/**
 * Register auth routes with the Express app
 */
export function registerAuthRoutes(app: Express): void {
  // Registration routes - /api/auth/register is primary, /api/auth/send-email-verification kept for compatibility
  app.post('/api/auth/register', handleSignup);
  app.post('/api/auth/signup', handleSignup);
  app.post('/api/auth/login', handleLogin);
  // Forgot password routes
  app.post('/api/auth/forgot-password', handleForgotPassword);
  app.post('/api/auth/reset-password', handleResetPassword);
}

/**
 * POST /api/auth/signup
 * Register a new user with email and password
 */
export async function handleSignup(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = request.body;

    // Validate and sanitize inputs
    const sanitizedEmail = sanitizeString(email, 'email');
    const sanitizedPassword = sanitizeString(password, 'password');

    if (!sanitizedEmail || !sanitizedPassword) {
      response.status(400).json({
        error: 'Email and password are required and must be valid strings',
      });
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();
    const trimmedPassword = sanitizedPassword;

    // Additional validation
    if (trimmedEmail.length < 5 || !trimmedEmail.includes('@')) {
      response.status(400).json({
        error: 'Please enter a valid email address',
      });
      return;
    }

    // Defense-in-Depth: Run server-side mirror verification
    // Early-Abort Rejection: If bot bypasses frontend controls, halt execution
    // Recreated identical string complexity regex pattern lookup tool
    const complexityError = validatePasswordComplexity(trimmedPassword);
    if (complexityError) {
      response.status(400).json({
        error: 'Security validation failure: Input credentials parameters violate complexity guidelines.',
      });
      return;
    }

    try {
      // Check if user already exists
      const existingUser = await UserModel.findOne({ email: trimmedEmail });
      if (existingUser) {
        response.status(409).json({
          error: 'An account with this email already exists',
        });
        return;
      }

      // Create user - password will be hashed by pre-save hook in UserModel
      const newUser = await UserModel.create({
        email: trimmedEmail,
        password: trimmedPassword,
      });

// Generate JWT token
      const token = jwt.sign(
        { userId: newUser._id.toString(), email: trimmedEmail },
        AUTH_CONFIG.JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
      );

      console.log(`[Auth] New user registered: ${trimmedEmail}`);

      response.status(201).json({
        ok: true,
        user: {
          id: newUser._id.toString(),
          email: trimmedEmail,
        },
        token,
      });
    } catch (dbError: any) {
      console.error('❌ [BACKEND SIGNUP CRASH]:', dbError.message, dbError.stack);
      response.status(500).json({ error: 'Registration database fault', details: dbError.message });
    }
  } catch (err: any) {
    console.error('❌ [BACKEND SIGNUP CRASH]:', err.message, err.stack);
    response.status(500).json({ error: 'Registration failed', details: err.message });
  }
}

/**
 * POST /api/auth/login
 * Authenticate an existing user and return JWT token
 * Uses timing-safe password comparison to prevent timing attacks
 */
export async function handleLogin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = request.body;

    // Validate and sanitize inputs
    const sanitizedEmail = sanitizeString(email, 'email');
    const sanitizedPassword = sanitizeString(password, 'password');

    if (!sanitizedEmail || !sanitizedPassword) {
      response.status(400).json({
        error: 'Email and password are required and must be valid strings',
      });
      return;
    }

const trimmedEmail = sanitizedEmail.trim().toLowerCase();

    console.log(`[Auth] Login attempt for: "${trimmedEmail}"`);
    console.log(`[Auth] Password length: ${sanitizedPassword?.length}`);

    try {
      // Find user by email
      const user = await UserModel.findOne({ email: trimmedEmail });
      console.log(`[Auth] User found:`, user ? `yes (id: ${user._id})` : 'no');

      // EXPLICIT VALIDATION GUARD: Ensure user document exists before proceeding
      // This prevents any bypass where user could be null/undefined
      if (!user) {
        console.log(`[AUTH FAILED]: No user document matched for input criteria.`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Additional guard: Verify user object has required properties
      if (!user._id || !user.email || !user.password) {
        console.error(`[AUTH FAILED]: User document missing required properties.`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Verify password using model's comparePassword method (timing-safe via bcrypt)
      const isValidPassword = await user.comparePassword(sanitizedPassword);
      if (!isValidPassword) {
        console.warn(`[Auth] Invalid password attempt for: ${trimmedEmail}`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

// Generate JWT token
      const token = jwt.sign(
        { userId: user._id.toString(), email: trimmedEmail },
        AUTH_CONFIG.JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
      );

      console.log(`[Auth] User logged in: ${trimmedEmail}`);

      response.json({
        ok: true,
        user: {
          id: user._id.toString(),
          email: trimmedEmail,
        },
        token,
      });
    } catch (dbError) {
      console.error('[Auth] Database error during login:', dbError);
      throw dbError;
    }
  } catch (err) {
    console.error('[Auth] Login error:', err);
    next(err);
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
      // Generate reset token
      const resetToken = generateResetToken();
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Save token to user (will be hashed by pre-save hook if password changed, but token field is plain)
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = resetExpires;
      await user.save();

      // In development, log the reset link to console
      // In production, this would send an actual email
      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}&email=${encodeURIComponent(trimmedEmail)}`;

      console.log(`\n========================================`);
      console.log(`[FORGOT PASSWORD] Reset link for: ${trimmedEmail}`);
await sendPasswordResetEmail(trimmedEmail, resetToken);
      console.log(`⏰ Expires in: 1 hour`);
      console.log(`========================================\n`);

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
  } catch (err: any) {
    console.error('[Auth] Forgot password error:', err.message, err.stack);
    response.status(500).json({ error: 'Failed to process password reset request' });
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

    // Verify token matches and hasn't expired
    if (
      user.resetPasswordToken !== trimmedToken ||
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

    console.log(`[RESET PASSWORD] Password successfully reset for: ${trimmedEmail}`);

    response.json({
      ok: true,
      message: 'Password has been reset successfully. You can now log in with your new password.',
    });
  } catch (err: any) {
    console.error('[Auth] Reset password error:', err.message, err.stack);
    response.status(500).json({ error: 'Failed to reset password' });
  }
}
