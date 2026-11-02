// DEMO_MODE=on: a public, read-only demo. Pages and GET requests work; every change is refused, outside
// services (BrickLink, Rebrickable, alerts) are switched off, and an empty database is filled with demo data.

export const DEMO_ERROR = 'This is a read-only demo. Install your own Brickfolio to make changes.';
export const INSTALL_URL = 'https://github.com/scoobydrew83/brickfolio#install';

export const isDemo = () => ['on', 'true', '1'].includes((process.env.DEMO_MODE ?? '').toLowerCase());

/** REST API in demo mode: only GET and HEAD. (Server actions check isDemo() themselves, so reads still work.) */
export const demoBlocks = (method: string) => isDemo() && method !== 'GET' && method !== 'HEAD';
