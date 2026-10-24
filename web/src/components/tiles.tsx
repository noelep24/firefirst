import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';

import type { Schemas } from '@/api/http';
import { useMe } from '@/auth';

import { type Area, visiblePages } from './sections';

/** The areas of the app as a column of links, each saying what needs attention there. */
export function AreaLinks({ areas, dashboard }: { areas: Area[]; dashboard?: Schemas['Dashboard'] }) {
  const { isAdmin } = useMe();
  return (
    <nav className="area-links" aria-label="Areas">
      {areas.map((area) => {
        const first = visiblePages(area, isAdmin)[0];
        if (!first) return null;
        const Icon = area.icon;
        const alerts = dashboard ? (area.alerts?.(dashboard) ?? []).filter((a) => a && a.tone !== 'neutral') : [];
        const tone = alerts.some((a) => a!.tone === 'danger') ? 'danger' : 'warning';
        return (
          <Link key={area.key} to={first.to} className="area-link">
            <span className="area-link-icon">
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="area-link-text">
              <span className="area-link-label">{area.label}</span>
              {alerts.length ? (
                <span className={`area-link-alert tone-${tone}`}>{alerts.map((a) => a!.text).join(' · ')}</span>
              ) : (
                <span className="area-link-description">{area.description}</span>
              )}
            </span>
            <ChevronRight size={16} aria-hidden="true" className="area-link-arrow" />
          </Link>
        );
      })}
    </nav>
  );
}
