import { expect, it } from 'vitest';
import { oauthHeader, pct } from './oauth';

// The worked example from Twitter's "Creating a signature" docs, a common OAuth 1.0a HMAC-SHA1 test vector.
it('signs the reference OAuth 1.0a example', async () => {
  const header = await oauthHeader(
    'POST',
    'https://api.twitter.com/1.1/statuses/update.json',
    { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    {
      consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
      consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    },
    'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    '1318622958',
  );
  expect(header).toContain(`oauth_signature="${pct('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')}"`);
});

it('percent-encodes like RFC 3986', () => expect(pct("a b!*'()")).toBe('a%20b%21%2A%27%28%29'));
