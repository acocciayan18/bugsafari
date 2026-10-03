import type { Express, Response, RequestHandler } from 'express';
import { Types } from 'mongoose';
import { optionalAuth, type AuthRequest } from '../authentication/authMiddleware.js';
import { writeLimiter } from '../middleware/rateLimiter.js';
import { SupportTicketModel } from '../../infrastructure/database/models/SupportTicketModel.js';
import { sendSupportTicketEmail, type SupportTicketEmail } from '../authentication/emailTransport.js';
import { isSupportCategory, SUPPORT_LIMITS, type SupportCategory, type SupportDiagnostics } from '../../../../shared/support.js';

import { createLogger } from '../../infrastructure/observability/logger.js';

const obsLog = createLogger('[API]');

const MODES = new Set(['contact', 'ticket', 'feature']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Whitelisted diagnostic keys. Anything else in the body is dropped, so no token
// or arbitrary field can ride along into storage or the admin email.
const DIAG_KEYS: readonly (keyof SupportDiagnostics)[] = ['appVersion', 'route', 'userAgent', 'viewport', 'language', 'accountType', 'submittedAt'];
const DIAG_VALUE_MAX = 400;

function trimmedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

// Keep only known keys with bounded string values; return null when nothing survives.
export function sanitizeDiagnostics(value: unknown): SupportDiagnostics | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const clean: Partial<Record<keyof SupportDiagnostics, string>> = {};
  for (const key of DIAG_KEYS) {
    const raw = source[key];
    if (typeof raw === 'string' && raw.trim()) clean[key] = raw.trim().slice(0, DIAG_VALUE_MAX);
  }
  return Object.keys(clean).length ? (clean as SupportDiagnostics) : null;
}

export interface SupportTicketInput {
  userId: string | null;
  email: string;
  mode: string;
  category: SupportCategory;
  subject: string;
  description: string;
  details: string | null;
  diagnostics: SupportDiagnostics | null;
}

// Persistence + notification injected so the handler stays pure and testable.
export interface SupportHandlerDeps {
  createTicket: (input: SupportTicketInput) => Promise<{ id: string }>;
  sendTicketEmail: (payload: SupportTicketEmail) => Promise<{ ok: boolean }>;
}

// Support intake. Guests may submit too (they supply their own contact email);
// an authenticated operator's address always comes from their verified token,
// never from the request body, so a ticket can't be attributed to someone else.
export function createSupportHandler(deps: SupportHandlerDeps): RequestHandler {
  return async (request: AuthRequest, response: Response): Promise<void> => {
    const mode = typeof request.body?.mode === 'string' && MODES.has(request.body.mode) ? request.body.mode : null;
    const category: SupportCategory = isSupportCategory(request.body?.category) ? request.body.category : 'other';
    const subject = trimmedString(request.body?.subject, SUPPORT_LIMITS.subject);
    const description = trimmedString(request.body?.description, SUPPORT_LIMITS.description);
    const details = trimmedString(request.body?.details, SUPPORT_LIMITS.details);
    const diagnostics = sanitizeDiagnostics(request.body?.diagnostics);
    // An authenticated operator's address always comes from the token, never the body.
    const email = request.userEmail ?? trimmedString(request.body?.email, SUPPORT_LIMITS.email);

    if (!mode || !subject || !description) {
      response.status(400).json({ error: 'mode, subject and description are required.' });
      return;
    }
    if (!email || !EMAIL_PATTERN.test(email)) {
      response.status(400).json({ error: 'A valid contact email is required.' });
      return;
    }

    let ticketId: string;
    try {
      const ticket = await deps.createTicket({
        userId: request.userId ?? null,
        email,
        mode,
        category,
        subject,
        description,
        details,
        diagnostics,
      });
      ticketId = ticket.id;
      obsLog.info(`[API]  Support ticket ${ticketId} recorded (${mode}/${category}) from ${request.userId ?? 'guest'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      obsLog.error('[API]  Support ticket save failed:', message);
      response.status(500).json({ error: 'Could not record your request. Please try again.' });
      return;
    }

    // Best-effort admin notification. The ticket is already durably stored, so a
    // failed email never fails the request — it is logged and surfaced as a flag.
    const emailResult = await deps.sendTicketEmail({
      ticketId,
      category,
      subject,
      description,
      reporterEmail: email,
      accountLabel: request.userId ? 'Signed-in operator' : 'Guest',
      details,
      diagnostics,
    }).catch((error) => {
      obsLog.error('[API]  Support ticket email threw:', error instanceof Error ? error.message : String(error));
      return { ok: false };
    });

    response.status(201).json({ ok: true, ticketId, emailed: emailResult.ok });
  };
}

export function registerSupportRoutes(app: Express): void {
  const handler = createSupportHandler({
    createTicket: async (input) => {
      const ticket = await SupportTicketModel.create({
        ...input,
        userId: input.userId ? new Types.ObjectId(input.userId) : null,
      });
      return { id: ticket.id };
    },
    sendTicketEmail: sendSupportTicketEmail,
  });
  app.post('/api/support/tickets', writeLimiter, optionalAuth, handler);
}
