import { describe, expect, it } from 'vitest';
import { signInError } from './errors';

describe('sign-in errors from ?error=', () => {
  it('reads known codes in our words and never echoes markup from the URL', () => {
    expect(signInError('SIGNUP_CLOSED')).toBe('Sign-up is closed. Ask an admin to add you.');
    expect(signInError('account_not_linked')).toMatch(/already an account/);
    expect(signInError(null)).toBeNull();
    expect(signInError('<b>call 555</b>')).toBe("Sign-in didn't work (bcall555b). Try again.");
  });
});
