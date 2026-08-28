// Pure form logic for the Change Password flow. Kept framework-free so it is unit
// testable without a DOM; the component owns only rendering and timers.

export const PASSWORD_MIN_LENGTH = 8;

// Read window before the forced sign-out. A password change revokes every session,
// so the user is signed out; this delay lets them read the confirmation first.
export const SIGNOUT_COUNTDOWN_SECONDS = 5;

export interface PasswordFieldErrors {
  current?: string;
  new?: string;
  confirm?: string;
}

// Validates the three fields as a unit; empty object means the form may submit.
export function validatePasswordChange(
  current: string,
  next: string,
  confirm: string,
): PasswordFieldErrors {
  const errors: PasswordFieldErrors = {};

  if (!current) {
    errors.current = 'Current password is required';
  }

  if (!next) {
    errors.new = 'New password is required';
  } else if (next.length < PASSWORD_MIN_LENGTH) {
    errors.new = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  } else if (current && next === current) {
    errors.new = 'New password must differ from the current one';
  }

  if (!confirm) {
    errors.confirm = 'Please confirm your new password';
  } else if (next !== confirm) {
    errors.confirm = 'Passwords do not match';
  }

  return errors;
}

export function hasPasswordErrors(errors: PasswordFieldErrors): boolean {
  return Object.keys(errors).length > 0;
}
