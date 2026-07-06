import type { Express } from 'express';
import { handleTokenRefresh } from './authRefreshController.js';
import { handleSignup } from './authSignupController.js';
import { handleLogin } from './authLoginController.js';
import { handleForgotPassword, handleResetPassword } from './authPasswordResetController.js';

/**
 * Register auth routes with the Express app
 */
export function registerAuthRoutes(app: Express): void {
  // Registration routes - /api/auth/register is primary, /api/auth/send-email-verification kept for compatibility
  app.post('/api/auth/register', handleSignup);
  app.post('/api/auth/signup', handleSignup);
  app.post('/api/auth/login', handleLogin);
  // Token refresh endpoint - issues new token without requiring password
  app.post('/api/auth/refresh', handleTokenRefresh);
  // Forgot password routes
  app.post('/api/auth/forgot-password', handleForgotPassword);
  app.post('/api/auth/reset-password', handleResetPassword);
}
