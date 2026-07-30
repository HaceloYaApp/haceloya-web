import './BrandHeader.css';

// Mismo logo/wordmark que la landing (haceloya-web/index.html), siempre
// arriba a la izquierda y linkeado al sitio principal.
export default function BrandHeader() {
  return (
    <a href="https://haceloya.com/" className="brand-header">
      <svg width="26" height="26" viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <pattern id="bh-hz" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="14" height="14" fill="#14140F" />
            <rect width="7" height="14" fill="#FFC800" />
          </pattern>
        </defs>
        <g stroke="#14140F" strokeWidth="4" strokeLinejoin="round">
          <rect x="18" y="10" width="20" height="80" rx="6" fill="url(#bh-hz)" />
          <rect x="62" y="10" width="20" height="80" rx="6" fill="url(#bh-hz)" />
          <rect x="10" y="40" width="80" height="20" rx="6" fill="url(#bh-hz)" />
        </g>
      </svg>
      <span className="brand-header-word">Hacelo Ya</span>
    </a>
  );
}
