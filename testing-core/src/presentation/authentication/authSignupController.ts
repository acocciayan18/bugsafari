import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import { AUTH_CONFIG } from './authConfig.js';
import { sanitizeString, validatePasswordComplexity } from './authValidation.js';

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
        AUTH_CONFIG.JWT_SECRET,
        { expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN } as jwt.SignOptions,
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
