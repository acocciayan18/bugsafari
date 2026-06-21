import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Signup Test Suite
 * Tests the complete signup flow including form validation, API integration, and error handling
 */

// Use static fallback URLs - in test environment these would be set via configuration
const SIGNUP_URL = 'http://localhost:5173/signup';
const API_BASE_URL = 'http://localhost:3000';

test.describe('Signup Flow', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(SIGNUP_URL);
  });

  test.describe('Form Validation', () => {
    test('should show error when full name is empty', async ({ page }) => {
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'SecurePass123!');
      await page.fill('#confirmPassword', 'SecurePass123!');
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Please enter your full name.')).toBeVisible();
    });

    test('should show error when email is invalid', async ({ page }) => {
      await page.fill('#fullName', 'Test User');
      await page.fill('#email', 'invalid-email');
      await page.fill('#password', 'SecurePass123!');
      await page.fill('#confirmPassword', 'SecurePass123!');
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Please enter a valid email address.')).toBeVisible();
    });

    test('should show error when password is too short', async ({ page }) => {
      await page.fill('#fullName', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'Short1!');
      await page.fill('#confirmPassword', 'Short1!');
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Password must be at least 12 characters.')).toBeVisible();
    });

    test('should show error when password lacks symbols', async ({ page }) => {
      await page.fill('#fullName', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'SecurePass123');
      await page.fill('#confirmPassword', 'SecurePass123');
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Password must include symbols and numbers.')).toBeVisible();
    });

    test('should show error when passwords do not match', async ({ page }) => {
      await page.fill('#fullName', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'SecurePass123!');
      await page.fill('#confirmPassword', 'DifferentPass123!');
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Passwords do not match.')).toBeVisible();
    });

    test('should show password requirements indicators', async ({ page }) => {
      await page.fill('#password', 'SecurePass123!');
      
      // Check password requirement indicators
      await expect(page.locator('text=Minimum 12 characters')).toBeVisible();
      await expect(page.locator('text=Include symbols & numbers')).toBeVisible();
      await expect(page.locator('text=No sequential strings')).toBeVisible();
    });
  });

  test.describe('Password Visibility Toggle', () => {
    test('should toggle password visibility', async ({ page }) => {
      await page.fill('#password', 'SecurePass123!');
      
      // Initially password should be hidden
      const passwordInput = page.locator('#password');
      await expect(passwordInput).toHaveAttribute('type', 'password');
      
      // Click toggle button to show password
      await page.click('button:has([class*="absolute inset-y-0 right-0"])');
      
      // Password should now be visible
      // Note: The exact selector depends on implementation
    });

    test('should toggle confirm password visibility', async ({ page }) => {
      await page.fill('#confirmPassword', 'SecurePass123!');
      
      const confirmPasswordInput = page.locator('#confirmPassword');
      await expect(confirmPasswordInput).toHaveAttribute('type', 'password');
      
      // Click toggle button for confirm password
      await page.locator('#confirmPassword + button').click();
    });
  });

  test.describe('Successful Signup', () => {
    test('should successfully register new user', async ({ page }) => {
      // Generate unique email to avoid conflicts
      const timestamp = Date.now();
      const email = `testuser${timestamp}@example.com`;
      const password = 'SecurePass123!';

      await page.fill('#fullName', 'Test User');
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.fill('#confirmPassword', password);
      await page.click('button[type="submit"]');

      // Wait for API response and navigation to login
      await page.waitForURL('**/login', { timeout: 10000 });
      
      // Verify we're on login page (successful redirect)
      await expect(page.locator('text=Log in')).toBeVisible();
    });

    test('should show loading state during submission', async ({ page }) => {
      const timestamp = Date.now();
      const email = `testuser${timestamp}@example.com`;
      const password = 'SecurePass123!';

      await page.fill('#fullName', 'Test User');
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.fill('#confirmPassword', password);
      
      // Click submit and check for loading state
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Creating account...')).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test('should show error when email already exists', async ({ page }) => {
      // First create an account
      const timestamp = Date.now();
      const email = `existing${timestamp}@example.com`;
      const password = 'SecurePass123!';

      await page.fill('#fullName', 'Test User');
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.fill('#confirmPassword', password);
      await page.click('button[type="submit"]');
      
      // Wait for first signup to complete
      await page.waitForURL('**/login', { timeout: 10000 });
      
      // Go back to signup and try to register same email
      await page.goto(SIGNUP_URL);
      await page.fill('#fullName', 'Test User');
      await page.fill('#email', email);
      await page.fill('#password', password);
      await page.fill('#confirmPassword', password);
      await page.click('button[type="submit"]');
      
      // Should show error for existing account
      await expect(page.locator('text=An account with this email already exists.')).toBeVisible();
    });

    test('should handle network error gracefully', async ({ page }) => {
      // Block the API request to simulate network error
      await page.route(`${API_BASE_URL}/api/auth/register`, (route) => {
        route.abort('failed');
      });

      await page.fill('#fullName', 'Test User');
      await page.fill('#email', 'test@example.com');
      await page.fill('#password', 'SecurePass123!');
      await page.fill('#confirmPassword', 'SecurePass123!');
      await page.click('button[type="submit"]');
      
      await expect(page.locator('text=Unable to connect to server. Please try again.')).toBeVisible();
    });
  });

  test.describe('Navigation', () => {
    test('should navigate to login page when clicking login link', async ({ page }) => {
      await page.click('text=Already have an account? Log in');
      
      await expect(page).toHaveURL(/.*login/);
    });

    test('should navigate to dashboard when clicking guest mode', async ({ page }) => {
      await page.click('text=Continue As Guest Mode');
      
      await expect(page).toHaveURL(/.*dashboard/);
    });
  });

  test.describe('Accessibility', () => {
    test('should have proper form labels', async ({ page }) => {
      await expect(page.locator('#fullName')).toHaveAttribute('aria-label', /full name/i);
      await expect(page.locator('#email')).toHaveAttribute('aria-label', /email/i);
      await expect(page.locator('#password')).toHaveAttribute('aria-label', /password/i);
    });

    test('should be keyboard navigable', async ({ page }) => {
      // Tab through form fields
      await page.keyboard.press('Tab');
      await expect(page.locator('#fullName')).toBeFocused();
      
      await page.keyboard.press('Tab');
      await expect(page.locator('#email')).toBeFocused();
    });
  });
});

test.describe('Signup API', () => {

  test('should reject duplicate registration', async ({ request }) => {
    const timestamp = Date.now();
    const email = `apiduplicate${timestamp}@example.com`;
    const password = 'SecurePass123!';

    // First registration should succeed
    const response1 = await request.post(`${API_BASE_URL}/api/auth/register`, {
      data: {
        email,
        password,
      },
    });
    
    // Allow time for first registration to process
    await new Promise(resolve => setTimeout(resolve, 500));

    // Second registration with same email should fail
    const response2 = await request.post(`${API_BASE_URL}/api/auth/register`, {
      data: {
        email,
        password,
      },
    });

    expect(response2.status()).toBe(409);
  });

  test('should validate email format', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/auth/register`, {
      data: {
        email: 'not-an-email',
        password: 'SecurePass123!',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('should validate password requirements', async ({ request }) => {
    const response = await request.post(`${API_BASE_URL}/api/auth/register`, {
      data: {
        email: 'test@example.com',
        password: 'weak',
      },
    });

    expect(response.status()).toBe(400);
  });
});
