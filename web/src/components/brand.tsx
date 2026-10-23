/** The FireFirst mark: a Maltese cross in gold leaf, the fire service's emblem. */
export function MalteseCross({ size = 28 }: { size?: number }) {
  const arm = 'M50 50 L33 4 Q50 15 67 4 Z';
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className="maltese-cross">
      {[0, 90, 180, 270].map((angle) => (
        <path key={angle} d={arm} transform={`rotate(${angle} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="13" className="maltese-cross-center" />
    </svg>
  );
}

export function Brand({ large }: { large?: boolean }) {
  return (
    <span className={`brand ${large ? 'brand-large' : ''}`}>
      <MalteseCross size={large ? 40 : 28} />
      <span>FireFirst</span>
    </span>
  );
}

/** The department's own patch or logo, set in Department settings; the Maltese cross until one is uploaded. */
export function DepartmentEmblem({ logo, name, size }: { logo?: string | null; name?: string; size: number }) {
  if (logo) {
    return <img src={logo} alt={name ? `${name} logo` : ''} width={size} height={size} className="department-emblem" />;
  }
  return <MalteseCross size={size} />;
}
