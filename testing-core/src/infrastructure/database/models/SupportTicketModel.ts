import { Schema, model, Types, Document } from 'mongoose';

const supportTicketSchema = new Schema(
  {
    // Null for a guest submission — the ticket is still recorded, just unattributed.
    userId: {
      type: Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    // Contact address: the operator's account email, or the one they typed as a guest.
    email: {
      type: String,
      required: [true, 'A contact email is required'],
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email is too long'],
    },
    mode: {
      type: String,
      required: true,
      enum: ['contact', 'ticket', 'feature'],
      index: true,
    },
    // Issue type chosen by the operator; distinct from the entry-point mode.
    category: {
      type: String,
      required: true,
      enum: ['bug', 'feature', 'account', 'performance', 'question', 'other'],
      default: 'other',
      index: true,
    },
    subject: {
      type: String,
      required: [true, 'Subject is required'],
      trim: true,
      maxlength: [200, 'Subject cannot exceed 200 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [5000, 'Description cannot exceed 5000 characters'],
    },
    // Optional error/finding context the operator pasted in.
    details: {
      type: String,
      trim: true,
      maxlength: [4000, 'Details cannot exceed 4000 characters'],
      default: null,
    },
    // Non-sensitive environment snapshot (version/route/browser). No tokens or PII.
    diagnostics: {
      type: Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'ACKNOWLEDGED', 'CLOSED'],
      default: 'OPEN',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'support_tickets',
  },
);

supportTicketSchema.index({ userId: 1, createdAt: -1 });

export interface ISupportTicket extends Document {
  userId: Types.ObjectId | null;
  email: string;
  mode: 'contact' | 'ticket' | 'feature';
  category: 'bug' | 'feature' | 'account' | 'performance' | 'question' | 'other';
  subject: string;
  description: string;
  details: string | null;
  diagnostics: Record<string, string> | null;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
}

export const SupportTicketModel = model<ISupportTicket>('SupportTicket', supportTicketSchema);
