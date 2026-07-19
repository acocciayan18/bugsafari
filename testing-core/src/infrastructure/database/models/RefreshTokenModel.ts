import { Schema, model, Document, Types } from 'mongoose';

export interface IRefreshToken extends Document {
  // HMAC of the opaque token — the plaintext is only ever held by the client.
  tokenHash: string;
  userId: Types.ObjectId;
  // All tokens rotated from one login share a family; reuse revokes the family.
  familyId: string;
  expiresAt: Date;
  revokedAt?: Date;
  // Reason recorded for forensics: 'rotated' | 'reuse-detected' | 'logout' | 'password-reset'.
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: undefined },
    revokedReason: { type: String, default: undefined },
  },
  { timestamps: true, collection: 'refreshtokens' },
);

refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ familyId: 1 });
// Mongo reaps expired documents automatically; revoked-but-unexpired rows stay
// until their expiry so reuse of a rotated token is still detectable.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
