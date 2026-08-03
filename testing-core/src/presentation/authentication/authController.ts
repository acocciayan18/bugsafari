import type { Express } from 'express';
import { handleTokenRefresh, handleLogout } from './authRefreshController.js';
import { handleSignup } from './authSignupController.js';
import { handleLogin } from './authLoginController.js';
import { handleForgotPassword, handleResetPassword } from './authPasswordResetController.js';
import { handleVerifyEmail, handleResendVerification } from './authEmailVerificationController.js';
import {
  loginLimiter,
  loginIpLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
  verifyEmailLimiter,
  resendVerificationLimiter,
} from '../middleware/rateLimiter.js';

/**
 * Register auth routes with the Express app. Every route here is unauthenticated
 * by definition, so each carries its own abuse budget.
 */
export function registerAuthRoutes(app: Express): void {
  // Registration routes - /api/auth/register is primary alias of /api/auth/signup
  app.post('/api/auth/register', signupLimiter, handleSignup);
  app.post('/api/auth/signup', signupLimiter, handleSignup);
  // Email verification - confirm the address (auto-login) or re-send the link.
  app.post('/api/auth/verify-email', verifyEmailLimiter, handleVerifyEmail);
  app.post('/api/auth/resend-verification', resendVerificationLimiter, handleResendVerification);
  // Two buckets: per-(IP,email) catches targeted brute force, per-IP bounds spraying.
  app.post('/api/auth/login', loginIpLimiter, loginLimiter, handleLogin);
  // Rotating refresh: exchanges a refresh token for a new pair, reuse burns the family.
  app.post('/api/auth/refresh', refreshLimiter, handleTokenRefresh);
  app.post('/api/auth/logout', refreshLimiter, handleLogout);
  // Forgot password routes
  app.post('/api/auth/forgot-password', forgotPasswordLimiter, handleForgotPassword);
  app.post('/api/auth/reset-password', resetPasswordLimiter, handleResetPassword);
}
