// Readable text for the `?error=` codes Better Auth sends back to /sign-in from a provider callback or a sign-in link.
// Only known codes are shown in our words: `error_description` comes from the URL, so it's never put on the page.
const MESSAGES: Record<string, string> = {
  SIGNUP_CLOSED: 'Sign-up is closed. Ask an admin to add you.',
  signup_disabled: 'Sign-up is closed. Ask an admin to add you.',
  new_user_signup_disabled: 'Sign-up is closed. Ask an admin to add you.',
  PROVIDER_EMAIL_NOT_VERIFIED: "That account's email address isn't verified. Verify it with the provider first, or sign in another way.",
  email_not_verified: "That account's email address isn't verified. Verify it with the provider first, or sign in another way.",
  account_not_linked: "There's already an account with that email, and the provider hasn't verified the address. Sign in another way.",
  email_does_not_match: 'That account has a different email address.',
  account_already_linked_to_different_user: 'That account is already linked to someone else.',
  email_not_found: "The provider didn't share an email address. Allow access to your email and try again.",
  NOT_ALLOWED: "You don't have access.",
  INVALID_TOKEN: 'That sign-in link has expired or was already used. Ask for a new one.',
  EXPIRED_TOKEN: 'That sign-in link has expired. Ask for a new one.',
  access_denied: 'Sign-in was cancelled.',
  state_mismatch: 'Sign-in took too long or was started in another browser. Try again.',
  state_not_found: 'Sign-in took too long or was started in another browser. Try again.',
  please_restart_the_process: 'Sign-in took too long or was started in another browser. Try again.',
};

export function signInError(code: string | undefined | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? `Sign-in didn't work (${code.replace(/[^\w-]/g, '').slice(0, 60)}). Try again.`;
}
