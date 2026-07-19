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
  subject: string;
  description: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
}

export const SupportTicketModel = model<ISupportTicket>('SupportTicket', supportTicketSchema);
