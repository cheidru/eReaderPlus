import './GalaxySpinner.css';

/** Pseudo-random numbers from a seed, so the galaxy is drawn the same every time. */
function random(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

interface Star {
  x: number;
  y: number;
  r: number;
  opacity: number;
  warm: boolean;
}

const ARMS = 2;
const STARS_PER_ARM = 80;
const ARM_TURNS = 1.25;

/** A point on arm `arm`, `along` (0..1) the way from the core to its tip. */
function armPoint(arm: number, along: number): [number, number] {
  const angle = arm * Math.PI + along * ARM_TURNS * 2 * Math.PI;
  const radius = 7 + along * 37;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/** Stars along two trailing spiral arms, denser and warmer near the core, scattered wider further out. */
const STARS: Star[] = Array.from({ length: ARMS * STARS_PER_ARM }, (_, i) => {
  const along = random(i + 3000) ** 0.8;
  const [x, y] = armPoint(i % ARMS, along);
  const scatter = 1.5 + along * 5;
  return {
    x: x + (random(i) - 0.5) * scatter,
    y: y + (random(i + 500) - 0.5) * scatter,
    r: 0.3 + random(i + 1000) * (0.9 - along * 0.4),
    opacity: 0.5 + random(i + 1500) * 0.5,
    warm: along < 0.2 || random(i + 2000) < 0.12,
  };
});

/**
 * The glow of each arm, the light of stars too faint to see one by one: short pieces of the spiral, wide and bright
 * near the core and thinner towards the tip.
 */
const ARM_PIECES = 16;
const GLOW = Array.from({ length: ARMS * ARM_PIECES }, (_, i) => {
  const arm = i % ARMS;
  const from = Math.floor(i / ARMS) / ARM_PIECES;
  const points = [0, 0.5, 1].map((k) => armPoint(arm, from + k / ARM_PIECES).map((v) => v.toFixed(2)).join(' '));
  return { d: `M${points[0]} Q${points[1]} ${points[2]}`, width: 9 - from * 6, opacity: 0.55 - from * 0.35 };
});

/**
 * A small Milky Way that spins in 3D while it rocks back and forth: the wait for a book still being imported.
 * Purely decorative; the surrounding text says what is happening.
 */
export function GalaxySpinner() {
  return (
    <div className="galaxy-spinner" aria-hidden="true">
      <div className="galaxy-wag">
        <svg className="galaxy-disc" viewBox="-50 -50 100 100">
          <defs>
            <radialGradient id="galaxy-halo">
              <stop offset="0%" stopColor="#8fa8ff" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#5a64c8" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#3a3f8f" stopOpacity="0" />
            </radialGradient>
            <filter id="galaxy-blur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.2" />
            </filter>
            <radialGradient id="galaxy-core">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="30%" stopColor="#fff1c9" />
              <stop offset="65%" stopColor="#ffc46b" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#ff9f43" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle r="49" fill="url(#galaxy-halo)" />
          <g filter="url(#galaxy-blur)" fill="none" stroke="#9fb4ff" strokeLinecap="round">
            {GLOW.map((piece, i) => (
              <path key={i} d={piece.d} strokeWidth={piece.width} strokeOpacity={piece.opacity} />
            ))}
          </g>
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={s.warm ? '#ffe7b3' : '#d6e2ff'} opacity={s.opacity} />
          ))}
          <ellipse rx="16" ry="12" fill="url(#galaxy-core)" />
        </svg>
      </div>
    </div>
  );
}
