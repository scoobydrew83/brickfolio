// Downloads the LDraw parts library for the 3D view into LDRAW_LIBRARY_DIR (or the folder you pass).
//   npm run ldraw:download                  → $LDRAW_LIBRARY_DIR, else ./data/ldraw
//   node scripts/ldraw-download.mjs /ldraw   → that folder
// Same as Settings → Download the LDraw library, for when you'd rather use a terminal.
import { DEFAULT_ZIP_URL, installLibrary } from '../lib/ldraw/install.mjs';

const dir = process.argv[2] || process.env.LDRAW_LIBRARY_DIR || './data/ldraw';
const url = process.env.LDRAW_LIBRARY_ZIP_URL || DEFAULT_ZIP_URL;
let last = -1;
console.log(`Downloading ${url}\n  into ${dir}`);
try {
  await installLibrary(dir, {
    url,
    onProgress: (p) => {
      if (p.phase === 'extract') return console.log('Unzipping…');
      const mb = Math.floor(p.got / 1e6);
      if (mb >= last + 10) { last = mb; console.log(`  ${mb}${p.total ? ` of ${Math.round(p.total / 1e6)}` : ''} MB`); }
    },
  });
  console.log(`Done. Set LDRAW_LIBRARY_DIR=${dir} if it isn't already, and restart the app.`);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
