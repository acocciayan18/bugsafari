import type { Express, Response, NextFunction } from 'express';
import { UserModel } from '../../infrastructure/database/models/UserModel.js';
import type { AuthRequest } from './authMiddleware.js';
import { requireAuth } from './authMiddleware.js';
import { validatePasswordComplexity } from './authValidation.js';
import { revokeAllForUser } from './refreshTokenService.js';
import { writeLimiter, readLimiter, resetPasswordLimiter } from '../middleware/rateLimiter.js';

/**
 * User Settings Types
 */
export interface UserProfile {
    id: string;
    email: string;
    name?: string;
}

export interface UserSettings {
    theme: 'light' | 'dark' | 'system';
    notifications: boolean;
    autoSave: boolean;
}

/**
 * API Response helpers
 */
function jsonResponse(res: Response, status: number, data: unknown): void {
    res.status(status).json(data);
}

function errorResponse(res: Response, status: number, message: string): void {
    res.status(status).json({ error: message });
}

/**
 * GET /api/users/profile
 * Fetch authenticated user profile data
 */
export async function handleGetProfile(
    request: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const userId = request.userId;

        if (!userId) {
            errorResponse(res, 401, 'Authentication required');
            return;
        }

        const user = await UserModel.findById(userId).select('-password -resetPasswordToken -resetPasswordExpires');

        if (!user) {
            errorResponse(res, 404, 'User not found');
            return;
        }

        const profile: UserProfile = {
            id: user._id.toString(),
            email: user.email,
        };

        // @ts-expect-error - user may have name field from schema extensions
        if (user.name) {
            // @ts-expect-error - user may have name field from schema extensions
            profile.name = user.name;
        }

        jsonResponse(res, 200, { data: profile });
    } catch (error) {
        console.error('[Settings] Error fetching profile:', error);
        next(error);
    }
}

/**
 * PUT /api/users/profile
 * Update user profile (name)
 */
export async function handleUpdateProfile(
    request: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const userId = request.userId;

        if (!userId) {
            errorResponse(res, 401, 'Authentication required');
            return;
        }

        const { name } = request.body as { name?: string };

        // Validate name if provided
        if (name !== undefined && typeof name !== 'string') {
            errorResponse(res, 400, 'Name must be a string');
            return;
        }

        const updateData: { name?: string } = {};
        if (name && typeof name === 'string') {
            const trimmedName = name.trim();
            if (trimmedName.length > 0 && trimmedName.length <= 100) {
                updateData.name = trimmedName;
            }
        }

        const user = await UserModel.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        ).select('-password -resetPasswordToken -resetPasswordExpires');

        if (!user) {
            errorResponse(res, 404, 'User not found');
            return;
        }

        const profile: UserProfile = {
            id: user._id.toString(),
            email: user.email,
        };

        // @ts-expect-error - user may have name field from schema extensions
        if (user.name) {
            // @ts-expect-error - user may have name field from schema extensions
            profile.name = user.name;
        }

        jsonResponse(res, 200, { data: profile });
    } catch (error) {
        console.error('[Settings] Error updating profile:', error);
        next(error);
    }
}

/**
 * PUT /api/users/password
 * Change user password
 */
export async function handleChangePassword(
    request: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const userId = request.userId;

        if (!userId) {
            errorResponse(res, 401, 'Authentication required');
            return;
        }

        const { currentPassword, newPassword } = request.body as { currentPassword?: string; newPassword?: string };

        // Validate inputs
        if (!currentPassword || typeof currentPassword !== 'string') {
            errorResponse(res, 400, 'Current password is required');
            return;
        }

        if (!newPassword || typeof newPassword !== 'string') {
            errorResponse(res, 400, 'New password is required');
            return;
        }

        // Find user
        const user = await UserModel.findById(userId);

        if (!user) {
            errorResponse(res, 404, 'User not found');
            return;
        }

        // Verify current password. 403, not 401 — the caller IS authenticated, and
        // a 401 here reads to the client as an expired session and forces a logout.
        const isValidPassword = await user.comparePassword(currentPassword);
        if (!isValidPassword) {
            errorResponse(res, 403, 'Current password is incorrect');
            return;
        }

        // Same complexity floor as signup and reset — a change path must not be
        // the weakest way to set a password.
        const complexityError = validatePasswordComplexity(newPassword);
        if (complexityError) {
            errorResponse(res, 400, complexityError);
            return;
        }

        // Update password
        user.password = newPassword;
        await user.save();

        // Changing the password terminates every session it established.
        const revoked = await revokeAllForUser(userId, 'password-change');
        console.log(`[Settings] Password changed for ${userId} (${revoked} session(s) revoked)`);

        jsonResponse(res, 200, {
            message: 'Password changed successfully. Please sign in again.',
            sessionsRevoked: true,
        });
    } catch (error) {
        console.error('[Settings] Error changing password:', error);
        next(error);
    }
}

/**
 * GET /api/settings
 * Fetch user preferences/settings
 */
export async function handleGetSettings(
    request: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const userId = request.userId;

        if (!userId) {
            // Return default settings for unauthenticated users
            const defaultSettings: UserSettings = {
                theme: 'light',
                notifications: true,
                autoSave: true,
            };
            jsonResponse(res, 200, { data: defaultSettings });
            return;
        }

        const user = await UserModel.findById(userId).select('settings');

        if (!user) {
            // Return defaults if user not found
            const defaultSettings: UserSettings = {
                theme: 'light',
                notifications: true,
                autoSave: true,
            };
            jsonResponse(res, 200, { data: defaultSettings });
            return;
        }

        // Get settings from user document or use defaults
        const userSettings = user.settings as UserSettings | undefined;
        const settings: UserSettings = {
            theme: userSettings?.theme || 'light',
            notifications: userSettings?.notifications ?? true,
            autoSave: userSettings?.autoSave ?? true,
        };

        jsonResponse(res, 200, { data: settings });
    } catch (error) {
        console.error('[Settings] Error fetching settings:', error);
        // Return defaults on error to prevent UX breakage
        jsonResponse(res, 200, {
            data: {
                theme: 'light',
                notifications: true,
                autoSave: true
            }
        });
    }
}

/**
 * PUT /api/settings
 * Save user preferences/settings
 */
export async function handleUpdateSettings(
    request: AuthRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const userId = request.userId;

        if (!userId) {
            errorResponse(res, 401, 'Authentication required');
            return;
        }

        const { theme, notifications, autoSave } = request.body as {
            theme?: string;
            notifications?: boolean;
            autoSave?: boolean;
        };

        // Validate and sanitize inputs
        const updateData: Record<string, unknown> = {};

        // Theme validation
        if (theme !== undefined) {
            if (theme === 'light' || theme === 'dark' || theme === 'system') {
                updateData['settings.theme'] = theme;
            } else {
                errorResponse(res, 400, 'Theme must be "light", "dark", or "system"');
                return;
            }
        }

        // Notifications validation
        if (notifications !== undefined) {
            if (typeof notifications === 'boolean') {
                updateData['settings.notifications'] = notifications;
            } else {
                errorResponse(res, 400, 'Notifications must be a boolean');
                return;
            }
        }

        // AutoSave validation
        if (autoSave !== undefined) {
            if (typeof autoSave === 'boolean') {
                updateData['settings.autoSave'] = autoSave;
            } else {
                errorResponse(res, 400, 'AutoSave must be a boolean');
                return;
            }
        }

        // Update user settings
        const user = await UserModel.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true }
        ).select('settings');

        if (!user) {
            errorResponse(res, 404, 'User not found');
            return;
        }

        const userSettings = user.settings as UserSettings | undefined;
        const settings: UserSettings = {
            theme: userSettings?.theme || 'light',
            notifications: userSettings?.notifications ?? true,
            autoSave: userSettings?.autoSave ?? true,
        };

        jsonResponse(res, 200, { data: settings });
    } catch (error) {
        console.error('[Settings] Error updating settings:', error);
        next(error);
    }
}

/**
 * Register user settings routes with Express app
 */
export function registerUserSettingsRoutes(app: Express): void {
    // User profile routes
    app.get('/api/users/profile', readLimiter, requireAuth, handleGetProfile);
    app.put('/api/users/profile', writeLimiter, requireAuth, handleUpdateProfile);

    // Password change verifies currentPassword, so it gets the tight auth budget
    // rather than the general write budget.
    app.put('/api/users/password', resetPasswordLimiter, requireAuth, handleChangePassword);

    // Settings routes
    app.get('/api/settings', readLimiter, requireAuth, handleGetSettings);
    app.put('/api/settings', writeLimiter, requireAuth, handleUpdateSettings);

    console.log('[API] Registered user settings routes:');
    console.log('  GET  /api/users/profile');
    console.log('  PUT  /api/users/profile');
    console.log('  PUT  /api/users/password');
    console.log('  GET  /api/settings');
    console.log('  PUT  /api/settings');
}
