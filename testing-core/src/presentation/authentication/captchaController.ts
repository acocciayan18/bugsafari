import type { Request, Response } from 'express';
import { generateCaptcha } from './captchaService.js';

// GET /api/auth/captcha — issue a fresh signup challenge. No-store so a proxy or
// browser cache can never serve a stale (already-solved) token.
export function handleGetCaptcha(_request: Request, response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.status(200).json(generateCaptcha());
}
