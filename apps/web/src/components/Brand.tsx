import { asset } from "../base.js";

/**
 * The logo and wordmark, served from the repo-level assets/ directory via
 * Vite's publicDir. Both are decorative next to real text, so they carry empty
 * alt text rather than repeating the name to a screen reader.
 */
export function Brand({ tagline }: { tagline?: string }) {
  return (
    <div className="brand">
      <img className="brand-logo" src={asset("brigid-logo.svg")} alt="" />
      <img className="brand-wordmark" src={asset("brigid-title.svg")} alt="Brigid" />
      {tagline ? <p className="brand-tagline">{tagline}</p> : null}
    </div>
  );
}

export function BrandMark() {
  return <img className="mark" src={asset("brigid-logo.svg")} alt="" />;
}

/**
 * The wordmark as the app's heading. It stays wrapped in an h1 so the page keeps
 * a real top-level heading — the alt text is what a screen reader announces.
 */
export function BrandHeading() {
  return (
    <h1>
      <img className="wordmark" src={asset("brigid-title.svg")} alt="Brigid" />
    </h1>
  );
}
