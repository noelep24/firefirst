import { Link } from 'react-router';

import { useMe } from '@/auth';

import { type Area, visiblePages } from './sections';

/** One quiet tile per area of the app. */
export function TileGrid({ areas }: { areas: Area[] }) {
  const { isAdmin } = useMe();
  return (
    <div className="tile-grid">
      {areas.map((area) => {
        const first = visiblePages(area, isAdmin)[0];
        if (!first) return null;
        const Icon = area.icon;
        return (
          <Link key={area.key} to={first.to} className="tile">
            <span className="tile-icon">
              <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="tile-label">{area.label}</span>
            <span className="tile-description">{area.description}</span>
          </Link>
        );
      })}
    </div>
  );
}
