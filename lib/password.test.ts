// Password hashing (#90): PBKDF2 on Workers, scrypt elsewhere, and either verifies anywhere.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashPassword as scryptHash } from 'better-auth/crypto';
import { constantTimeEqual, hashPassword, onWorkers, pbkdf2Hash, PBKDF2_ITERATIONS, verifyPassword } from './password';

const onWorkerd = () => vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
afterEach(() => { vi.unstubAllGlobals(); });

// Made up at run time, so no password-shaped literal sits in the repo for secret scanners to flag.
const PW = crypto.randomUUID(), PW2 = crypto.randomUUID();

describe('hashPassword', () => {
  it('uses scrypt off Workers and PBKDF2-SHA256 at 100,000 iterations on Workers', async () => {
    expect(onWorkers()).toBe(false);
    expect(await hashPassword(PW)).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    onWorkerd();
    expect(onWorkers()).toBe(true);
    const h = await hashPassword(PW);
    expect(h).toMatch(new RegExp(`^pbkdf2\\$${PBKDF2_ITERATIONS}\\$[A-Za-z0-9+/=]+\\$[A-Za-z0-9+/=]+$`));
    expect(h).not.toBe(await hashPassword(PW)); // salted
  });
});

describe('verifyPassword', () => {
  it('accepts both formats, wherever it runs', async () => {
    const p = await pbkdf2Hash(PW);
    const s = await scryptHash(PW);
    for (const workers of [false, true]) {
      if (workers) onWorkerd();
      expect(await verifyPassword({ hash: p, password: PW })).toBe(true);
      expect(await verifyPassword({ hash: s, password: PW })).toBe(true);
      expect(await verifyPassword({ hash: p, password: PW.slice(0, -1) + 'x' })).toBe(false);
      expect(await verifyPassword({ hash: s, password: PW2 })).toBe(false);
    }
  });

  it('reads the iteration count from the hash, and refuses broken or oversized ones', async () => {
    expect(await verifyPassword({ hash: await pbkdf2Hash(PW2, 1000), password: PW2 })).toBe(true);
    for (const hash of ['pbkdf2$', 'pbkdf2$abc$x$y', 'pbkdf2$100000$!!$!!', `pbkdf2$${PBKDF2_ITERATIONS + 1}$AAAA$AAAA`, 'nonsense', '']) {
      expect(await verifyPassword({ hash, password: PW2 })).toBe(false);
    }
  });

  it('compares in constant time', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2]))).toBe(false);
  });
});
