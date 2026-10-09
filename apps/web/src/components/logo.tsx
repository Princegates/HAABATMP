'use client';
import { useState } from 'react';

/**
 * The HAAB logo, exactly as supplied (apps/web/public/brand/haab-logo.png), made white on dark areas with the same
 * CSS filter the website uses. Until the file is added, a plain wordmark is shown. The logo is never redrawn.
 */
export function Logo({ onDark = true, height = 64 }: { onDark?: boolean; height?: number }) {
  const [missing, setMissing] = useState(false);
  if (missing) {
    return <div className="brand-word" style={onDark ? undefined : { color: 'var(--text)' }}>HAAB Aviation<small>Consultancy Services</small></div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/haab-logo.png" alt="HAAB Aviation Consultancy Services" className="brand-logo" style={{ height, filter: onDark ? 'brightness(0) invert(1)' : 'none' }} onError={() => setMissing(true)} />;
}
