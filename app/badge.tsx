import { ImageResponse } from 'next/og';

// A plain 2×2 brick seen from above, drawn as a square PNG for the favicon and home-screen icon.
export const badge = (px: number) =>
  new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexWrap: 'wrap', alignContent: 'center', justifyContent: 'center', gap: px * 0.08, padding: px * 0.14, background: '#fbbf24', borderRadius: px * 0.18 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ width: px * 0.3, height: px * 0.3, borderRadius: '50%', background: '#fcd34d', border: `${Math.max(1, px * 0.02)}px solid #d97706` }} />
        ))}
      </div>
    ),
    { width: px, height: px },
  );
