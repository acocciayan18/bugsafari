import type { Express, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'bugsafari-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
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

    if (!email || !password) {
      response.status(400).json({
        error: 'Email and password are required',
      });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (trimmedEmail.length < 5 || !trimmedEmail.includes('@')) {
      response.status(400).json({
        error: 'Please enter a valid email address',
      });
      return;
    }

    if (password.length < 8) {
      response.status(400).json({
        error: 'Password must be at least 8 characters',
      });
      return;
    }

    // Check if user already exists
    const existingUser = await UserModel.findOne({ email: trimmedEmail });
    if (existingUser) {
      response.status(409).json({
        error: 'An account with this email already exists',
      });
      return;
    }

    // Hash password and create user
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await UserModel.create({
      email: trimmedEmail,
      password: hashedPassword,
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser._id.toString(), email: trimmedEmail },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
    );

    response.status(201).json({
      ok: true,
      user: {
        id: newUser._id.toString(),
        email: trimmedEmail,
      },
      token,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Authenticate an existing user and return JWT token
 */
export async function handleLogin(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password } = request.body;

    if (!email || !password) {
      response.status(400).json({
        error: 'Email and password are required',
      });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Find user by email
    const user = await UserModel.findOne({ email: trimmedEmail });
    if (!user) {
      response.status(401).json({
        error: 'Invalid email or password',
      });
      return;
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
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

    response.json({
      ok: true,
      user: {
        id: user._id.toString(),
        email: trimmedEmail,
      },
      token,
    });
  } catch (err) {
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
