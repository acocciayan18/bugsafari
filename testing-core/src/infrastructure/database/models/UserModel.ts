import { Schema, model, Document, CallbackError } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  password: string;
  name?: string;
  emailVerified: boolean;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  settings: {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    autoSave: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address'],
    },
    name: {
      type: String,
      trim: true,
      maxlength: [100, 'Name must be at most 100 characters'],
      default: undefined,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
    },
    // Explicit false only on accounts created after email verification shipped.
    // Pre-existing docs have no field (undefined) and the login guard treats only
    // an explicit `false` as unverified, so they are never locked out — no backfill.
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      default: undefined,
    },
    emailVerificationExpires: {
      type: Date,
      default: undefined,
    },
    resetPasswordToken: {
      type: String,
      default: undefined,
    },
    resetPasswordExpires: {
      type: Date,
      default: undefined,
    },
    settings: {
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'light' },
      notifications: { type: Boolean, default: true },
      autoSave: { type: Boolean, default: true },
    },
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

// No explicit email index — `unique: true` on the field already creates one.

/**
 * Pre-save hook for automatic password hashing
 * Ensures password is always hashed before storing in MongoDB
 */
userSchema.pre<IUser>('save', async function (next) {
  try {
    // Only hash if password is modified or new
    if (!this.isModified('password')) {
      return next();
    }

    // Validate password is a string (prevent NoSQL injection via password field)
    if (typeof this.password !== 'string') {
      const error = new Error('Password must be a string');
      return next(error);
    }

    // Generate salt and hash
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error: any) {
    console.error('[UserModel] Password hashing error:', error.message, error.stack);
    next(error as CallbackError);
  }
});

/**
 * Method to compare passwords with timing-safe comparison
 * Returns promise to support async bcrypt.compare
 */
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    console.error('[UserModel] Password comparison error:', error);
    return false;
  }
};

export const UserModel = model<IUser>('User', userSchema);
