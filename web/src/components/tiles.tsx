import { Link } from 'react-router';

import type { Section } from './sections';

/** A grid of quiet icon tiles, one per section. */
export function TileGrid({ sections }: { sections: Pick<Section, 'to' | 'label' | 'icon'>[] }) {
  return (
    <div className="tile-grid">
      {sections.map(({ to, label, icon: Icon }) => (
        <Link key={to} to={to} className="tile">
          <span className="tile-icon">
            <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="tile-label">{label}</span>
        </Link>
      ))}
    </div>
  );
}
