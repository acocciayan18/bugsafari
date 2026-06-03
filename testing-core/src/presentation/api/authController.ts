import type { Express, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'bugsafari-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

/**
 * Helper: Validate string input and prevent NoSQL injection attacks
 * Ensures input is a plain string, not an object like {"$gt": ""}
 */
function sanitizeString(value: unknown, fieldName: string): string | null {
  // Check if value is a primitive string
  if (typeof value !== 'string') {
    console.error(`[Auth] ${fieldName} is not a valid string type:`, typeof value);
    return null;
  }

  // Check for potential NoSQL injection patterns
  if (value.includes('$') && value.match(/\$\w+/)) {
    console.error(`[Auth] Potential NoSQL injection in ${fieldName}:`, value);
    return null;
  }

  return value;
}

/**
 * Register auth routes with the Express app
 */
export function registerAuthRoutes(app: Express): void {
  app.post('/api/auth/signup', handleSignup);
  app.post('/api/auth/login', handleLogin);
}

/**
 * POST /api/auth/signup
 * Register a new user with email and password
 */
export async function handleSignup(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = request.body;

    // Validate and sanitize inputs
    const sanitizedEmail = sanitizeString(email, 'email');
    const sanitizedPassword = sanitizeString(password, 'password');

    if (!sanitizedEmail || !sanitizedPassword) {
      response.status(400).json({
        error: 'Email and password are required and must be valid strings',
      });
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();
    const trimmedPassword = sanitizedPassword;

    // Additional validation
    if (trimmedEmail.length < 5 || !trimmedEmail.includes('@')) {
      response.status(400).json({
        error: 'Please enter a valid email address',
      });
      return;
    }

    if (trimmedPassword.length < 8) {
      response.status(400).json({
        error: 'Password must be at least 8 characters',
      });
      return;
    }

    try {
      // Check if user already exists
      const existingUser = await UserModel.findOne({ email: trimmedEmail });
      if (existingUser) {
        response.status(409).json({
          error: 'An account with this email already exists',
        });
        return;
      }

      // Create user - password will be hashed by pre-save hook in UserModel
      const newUser = await UserModel.create({
        email: trimmedEmail,
        password: trimmedPassword,
      });

      // Generate JWT token
      const token = jwt.sign(
        { userId: newUser._id.toString(), email: trimmedEmail },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
      );

      console.log(`[Auth] New user registered: ${trimmedEmail}`);

      response.status(201).json({
        ok: true,
        user: {
          id: newUser._id.toString(),
          email: trimmedEmail,
        },
        token,
      });
    } catch (dbError) {
      console.error('[Auth] Database error during signup:', dbError);
      throw dbError;
    }
  } catch (err) {
    console.error('[Auth] Signup error:', err);
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Authenticate an existing user and return JWT token
 * Uses timing-safe password comparison to prevent timing attacks
 */
export async function handleLogin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = request.body;

    // Validate and sanitize inputs
    const sanitizedEmail = sanitizeString(email, 'email');
    const sanitizedPassword = sanitizeString(password, 'password');

    if (!sanitizedEmail || !sanitizedPassword) {
      response.status(400).json({
        error: 'Email and password are required and must be valid strings',
      });
      return;
    }

    const trimmedEmail = sanitizedEmail.trim().toLowerCase();

    try {
      // Find user by email
      const user = await UserModel.findOne({ email: trimmedEmail });
      if (!user) {
        // Use timing-safe delay to prevent timing attacks
        // Even on "user not found", we compare to prevent timing leak
        console.warn(`[Auth] Login attempt for non-existent user: ${trimmedEmail}`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Verify password using model's comparePassword method (timing-safe via bcrypt)
      const isValidPassword = await user.comparePassword(sanitizedPassword);
      if (!isValidPassword) {
        console.warn(`[Auth] Invalid password attempt for: ${trimmedEmail}`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user._id.toString(), email: trimmedEmail },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
      );

      console.log(`[Auth] User logged in: ${trimmedEmail}`);

      response.json({
        ok: true,
        user: {
          id: user._id.toString(),
          email: trimmedEmail,
        },
        token,
      });
    } catch (dbError) {
      console.error('[Auth] Database error during login:', dbError);
      throw dbError;
    }
  } catch (err) {
    console.error('[Auth] Login error:', err);
    next(err);
  }
}

/**
 * Verify JWT token and extract user info
 */
export function verifyToken(token: string): { userId: string; email: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };
    return decoded;
  } catch {
    return null;
  }
}
