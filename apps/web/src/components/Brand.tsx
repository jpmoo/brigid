/**
 * The logo and wordmark, served from the repo-level assets/ directory via
 * Vite's publicDir. Both are decorative next to real text, so they carry empty
 * alt text rather than repeating the name to a screen reader.
 */
export function Brand({ tagline }: { tagline?: string }) {
  return (
    <div className="brand">
      <img className="brand-logo" src="/brigid-logo.svg" alt="" />
      <img className="brand-wordmark" src="/brigid-title.svg" alt="Brigid" />
      {tagline ? <p className="brand-tagline">{tagline}</p> : null}
    </div>
  );
}

export function BrandMark() {
  return <img className="mark" src="/brigid-logo.svg" alt="" />;
}
