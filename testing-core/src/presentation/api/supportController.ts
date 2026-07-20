import type { Express, Response } from 'express';
import { Types } from 'mongoose';
import { optionalAuth, type AuthRequest } from '../authentication/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { SupportTicketModel } from '../../infrastructure/database/models/SupportTicketModel.js';

const MODES = new Set(['contact', 'ticket', 'feature']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

// Support intake. Guests may submit too (they supply their own contact email);
// an authenticated operator's address always comes from their verified token,
// never from the request body, so a ticket can't be attributed to someone else.
export function registerSupportRoutes(app: Express): void {
  app.post('/api/support/tickets', writeLimiter, optionalAuth, async (request: AuthRequest, response: Response): Promise<void> => {
    const mode = typeof request.body?.mode === 'string' && MODES.has(request.body.mode) ? request.body.mode : null;
    const subject = trimmedString(request.body?.subject, 200);
    const description = trimmedString(request.body?.description, 5000);
    const email = request.userEmail ?? trimmedString(request.body?.email, 254);

    if (!mode || !subject || !description) {
      response.status(400).json({ error: 'mode, subject and description are required.' });
      return;
    }
    if (!email || !EMAIL_PATTERN.test(email)) {
      response.status(400).json({ error: 'A valid contact email is required.' });
      return;
    }

    try {
      const ticket = await SupportTicketModel.create({
        userId: request.userId ? new Types.ObjectId(request.userId) : null,
        email,
        mode,
        subject,
        description,
      });
      console.log(`[API]  Support ticket ${ticket.id} recorded (${mode}) from ${request.userId ?? 'guest'}`);
      response.status(201).json({ ok: true, ticketId: ticket.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[API]  Support ticket save failed:', message);
      response.status(500).json({ error: 'Could not record your request. Please try again.' });
    }
  });
}
