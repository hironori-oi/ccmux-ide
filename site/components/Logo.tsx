/**
 * <Logo /> — inline SVG mark for the Sumi brand.
 *
 * Renders the logo-mark (stroke + orange drop) as inline SVG so it can be
 * tinted via `currentColor` (matching surrounding text). The orange drop
 * is hard-coded per brand rule (accent color is LOCKED).
 *
 * @see public/brand/BRAND.md for usage rules.
 */
export function Logo({
  size = 28,
  className = "",
  ariaLabel = "Sumi",
}: {
  size?: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
      className={className}
      fill="none"
    >
      <defs>
        <linearGradient id="logo-comp-kasure" x1="0.05" y1="0" x2="0.95" y2="0.02">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.92" />
          <stop offset="8%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="42%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="64%" stopColor="currentColor" stopOpacity="0.96" />
          <stop offset="78%" stopColor="currentColor" stopOpacity="0.72" />
          <stop offset="88%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="96%" stopColor="currentColor" stopOpacity="0.08" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path
        d="M 9.0 28.3 C 12.3 27.0 17.0 26.5 22.5 26.75 C 28.75 27.0 34.5 27.5 40.0 28.25 C 45.25 29.0 49.9 29.9 54.0 30.9 L 56.25 31.4 C 56.5 32.0 56.5 32.6 56.25 33.2 L 54.25 33.6 C 49.9 34.4 45.1 34.9 39.25 35.0 C 32.5 35.1 26.0 34.9 20.5 34.5 C 15.75 34.2 12.1 33.7 9.5 33.1 C 9.0 32.5 8.75 30.0 9.0 28.3 Z"
        fill="url(#logo-comp-kasure)"
      />
      <ellipse cx="13.3" cy="46.3" rx="3.0" ry="3.45" fill="#c15f3c" />
      <ellipse cx="12.5" cy="45.2" rx="0.85" ry="1.0" fill="#f3eee7" fillOpacity="0.26" />
    </svg>
  );
}

/**
 * <Wordmark /> — the "sumi" text as vector paths.
 * Font-independent (no Geist dependency at render time).
 */
export function Wordmark({
  height = 22,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  // Source wordmark viewBox is 160x64, cap-height 24 at baseline 44.
  // Scale height input to that 64u tall canvas.
  const width = Math.round((height / 64) * 120);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 120 64"
      width={width}
      height={height}
      role="img"
      aria-label="sumi"
      className={className}
      fill="currentColor"
    >
      {/* s */}
      <path d="M 28.6 30.8 C 28.6 28.2 26.6 26.8 22.8 26.8 C 19.2 26.8 17.0 28.4 17.0 30.6 C 17.0 32.2 18.2 33.2 20.6 33.6 L 24.4 34.2 C 28.4 34.8 30.6 36.6 30.6 39.6 C 30.6 43.2 27.2 45.6 22.2 45.6 C 17.2 45.6 14.2 43.2 14.0 39.8 L 17.0 39.8 C 17.2 41.8 19.2 43.0 22.2 43.0 C 25.4 43.0 27.4 41.6 27.4 39.6 C 27.4 38.0 26.4 37.0 23.8 36.6 L 19.8 36.0 C 15.8 35.4 13.8 33.6 13.8 30.6 C 13.8 27.0 17.0 24.4 22.6 24.4 C 28.0 24.4 31.4 27.0 31.6 30.8 Z" />
      {/* u */}
      <path d="M 38.4 25.0 L 41.4 25.0 L 41.4 38.2 C 41.4 41.6 43.2 43.0 46.2 43.0 C 49.2 43.0 51.0 41.6 51.0 38.2 L 51.0 25.0 L 54.0 25.0 L 54.0 45.2 L 51.0 45.2 L 51.0 42.2 C 50.0 44.4 47.8 45.6 45.2 45.6 C 41.2 45.6 38.4 43.2 38.4 38.4 Z" />
      {/* m */}
      <path d="M 62.2 25.0 L 65.2 25.0 L 65.2 28.0 C 66.2 25.8 68.2 24.6 70.8 24.6 C 73.8 24.6 75.8 26.0 76.6 28.4 C 77.6 26.0 79.8 24.6 82.6 24.6 C 86.6 24.6 89.2 27.0 89.2 31.8 L 89.2 45.2 L 86.2 45.2 L 86.2 32.0 C 86.2 28.6 84.6 27.2 81.8 27.2 C 79.0 27.2 77.2 28.8 77.2 32.2 L 77.2 45.2 L 74.2 45.2 L 74.2 32.0 C 74.2 28.6 72.6 27.2 69.8 27.2 C 67.0 27.2 65.2 28.8 65.2 32.2 L 65.2 45.2 L 62.2 45.2 Z" />
      {/* i */}
      <circle cx="98.8" cy="19.2" r="1.8" />
      <path d="M 97.2 25.0 L 100.2 25.0 L 100.2 45.2 L 97.2 45.2 Z" />
    </svg>
  );
}
