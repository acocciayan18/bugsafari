import { Schema, model, Document, CallbackError } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  password: string;
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
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
    },
  },
  {
    timestamps: true,
    collection: 'safari_users',
  },
);

// Index for efficient email lookups
userSchema.index({ email: 1 });

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
  } catch (error) {
    console.error('[UserModel] Password hashing error:', error);
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
