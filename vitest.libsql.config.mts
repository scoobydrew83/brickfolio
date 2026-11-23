// Spike for #90: the normal suite, but every test database is libSQL (see lib/db/libsql.test-setup.ts).
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.mts';

export default mergeConfig(base, defineConfig({ test: { setupFiles: ['./lib/db/libsql.test-setup.ts'] } }));
