import type { Express } from 'express';
import { handleTokenRefresh, handleLogout } from './authRefreshController.js';
import { handleSignup } from './authSignupController.js';
import { handleLogin } from './authLoginController.js';
import { handleForgotPassword, handleResetPassword } from './authPasswordResetController.js';
import {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
  refreshLimiter,
} from '../middleware/rateLimiter.js';

/**
 * Register auth routes with the Express app. Every route here is unauthenticated
 * by definition, so each carries its own abuse budget.
 */
export function registerAuthRoutes(app: Express): void {
  // Registration routes - /api/auth/register is primary, /api/auth/send-email-verification kept for compatibility
  app.post('/api/auth/register', signupLimiter, handleSignup);
  app.post('/api/auth/signup', signupLimiter, handleSignup);
  app.post('/api/auth/login', loginLimiter, handleLogin);
  // Rotating refresh: exchanges a refresh token for a new pair, reuse burns the family.
  app.post('/api/auth/refresh', refreshLimiter, handleTokenRefresh);
  app.post('/api/auth/logout', refreshLimiter, handleLogout);
  // Forgot password routes
  app.post('/api/auth/forgot-password', forgotPasswordLimiter, handleForgotPassword);
  app.post('/api/auth/reset-password', resetPasswordLimiter, handleResetPassword);
}
