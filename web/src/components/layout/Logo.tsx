/** El radar de la marca. Hereda el color del texto; el barrido va en el acento. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="7.1" fill="none" stroke="currentColor" strokeWidth=".9" opacity=".38" />
      <path d="M12 12 L12 3.4 A8.6 8.6 0 0 1 19.45 7.7 Z" fill="var(--accent)" opacity=".5" />
      <line x1="12" y1="12" x2="19.45" y2="7.7" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="15.9" cy="7.4" r="1.45" fill="var(--accent)" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" />
    </svg>
  );
}
