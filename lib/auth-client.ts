// Browser side of Better Auth (#90): sign-in and sign-up forms call these.
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

/** Where password sign-in goes when the account has two-factor on (app/sign-in/two-factor). */
export const TWO_FACTOR_PATH = '/sign-in/two-factor';

export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.assign(new URL(TWO_FACTOR_PATH, window.location.origin)); // a full load: the form's own navigation can't win
      },
    }),
  ],
});
