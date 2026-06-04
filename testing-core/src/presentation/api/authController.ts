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
 * Server-side password complexity validation - mirrors frontend regex criteria
 * Defense-in-Depth: Validates against 4 regex checks applied on frontend client
 * Uses regex pattern lookup approach for string complexity verification
 * Returns true if password meets ALL complexity requirements
 */
const PASSWORD_COMPLEXITY_PATTERNS: { name: string; regex: RegExp; errorMessage: string }[] = [
  {
    name: 'minLength',
    regex: /^.{8,}$/,
    errorMessage: 'Password must be at least 8 characters long',
  },
  {
    name: 'uppercase',
    regex: /[A-Z]/,
    errorMessage: 'Password must contain at least one uppercase letter (A-Z)',
  },
  {
    name: 'number',
    regex: /[0-9]/,
    errorMessage: 'Password must contain at least one numeric character (0-9)',
  },
  {
    name: 'specialChar',
    regex: /[^A-Za-z0-9]/,
    errorMessage: 'Password must contain at least one special character',
  },
];

/**
 * Validate password using regex pattern lookup approach
 * Returns the error message if validation fails, null if valid
 */
function validatePasswordComplexity(password: string): string | null {
  for (const pattern of PASSWORD_COMPLEXITY_PATTERNS) {
    if (!pattern.regex.test(password)) {
      return pattern.errorMessage;
    }
  }
  return null;
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

  // Check for empty or whitespace-only strings
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    console.error(`[Auth] ${fieldName} is empty or whitespace-only`);
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
  // Registration routes - /api/auth/register is primary, /api/auth/send-email-verification kept for compatibility
  app.post('/api/auth/register', handleSignup);
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

// Defense-in-Depth: Run server-side mirror verification
    // Early-Abort Rejection: If bot bypasses frontend controls, halt execution
    // Recreated identical string complexity regex pattern lookup tool
    const complexityError = validatePasswordComplexity(trimmedPassword);
    if (complexityError) {
      response.status(400).json({
        error: 'Security validation failure: Input credentials parameters violate complexity guidelines.',
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
    } catch (dbError: any) {
      console.error('❌ [BACKEND SIGNUP CRASH]:', dbError.message, dbError.stack);
      response.status(500).json({ error: 'Registration database fault', details: dbError.message });
    }
  } catch (err: any) {
    console.error('❌ [BACKEND SIGNUP CRASH]:', err.message, err.stack);
    response.status(500).json({ error: 'Registration failed', details: err.message });
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

      // EXPLICIT VALIDATION GUARD: Ensure user document exists before proceeding
      // This prevents any bypass where user could be null/undefined
      if (!user) {
        console.log(`[AUTH FAILED]: No user document matched for input criteria.`);
        response.status(401).json({
          error: 'Invalid email or password',
        });
        return;
      }

      // Additional guard: Verify user object has required properties
      if (!user._id || !user.email || !user.password) {
        console.error(`[AUTH FAILED]: User document missing required properties.`);
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
