import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { DepartmentEmblem, MalteseCross } from '@/components/brand';
import { OnboardingCard } from '@/components/onboarding';
import { AREAS, visiblePages } from '@/components/sections';
import { TileGrid } from '@/components/tiles';

/** The landing page: the department's emblem behind what needs attention and a tile for every area of the app. */
export default function Home() {
  const { me, isAdmin } = useMe();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => http.get<Schemas['Dashboard']>('/api/v1/dashboard/'),
  });
  const department = me.department;
  const firstName = me.first_name || me.full_name || me.username;
  const [now] = useState(() => new Date());
  const today = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const onDuty = dashboard.data?.platoon_on_duty;

  // Only what someone has to act on: warnings and problems, not information.
  // One line per area, e.g. "Supplies  2 below par · 2 expiring", marked by its most urgent item.
  const attention = dashboard.data
    ? AREAS.flatMap((area) => {
        const items = (area.alerts?.(dashboard.data) ?? []).filter((a) => a && a.tone !== 'neutral');
        if (items.length === 0) return [];
        const status = {
          text: items.map((a) => a!.text).join(' · '),
          tone: items.some((a) => a!.tone === 'danger') ? 'danger' : 'warning',
        };
        return [{ area, status, to: visiblePages(area, isAdmin)[0]?.to ?? '/' }];
      })
    : [];

  return (
    <div className="home">
      <div className="home-backdrop" aria-hidden="true">
        {department?.logo_url ? <img src={department.logo_url} alt="" /> : <MalteseCross size={640} />}
      </div>

      <header className="home-head">
        <DepartmentEmblem logo={department?.logo_url} name={department?.name} size={64} />
        <div>
          <h1>
            {greeting(now)}, {firstName}
          </h1>
          <p className="muted">
            {today}
            {onDuty ? ` · ${onDuty} Shift on duty` : ''}
          </p>
        </div>
      </header>

      <OnboardingCard />

      {dashboard.data ? (
        <section className="attention" aria-label="Needs attention">
          {attention.length === 0 ? (
            <div className="attention-clear">
              <CircleCheck size={18} aria-hidden="true" />
              All clear. Nothing needs your attention.
            </div>
          ) : (
            attention.map(({ area, status, to }) => (
              <Link key={area.key} to={to} className="attention-row">
                <span className={`dot tone-${status.tone}`} aria-hidden="true" />
                <span className="attention-label">{area.label}</span>
                <span className="muted">{status.text}</span>
                <ChevronRight size={16} aria-hidden="true" className="attention-arrow" />
              </Link>
            ))
          )}
        </section>
      ) : null}

      {isAdmin && !department?.logo_url ? (
        <Link to="/settings" className="home-hint">
          Add your department's patch or logo in Department settings.
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ) : null}

      <TileGrid areas={AREAS} />
    </div>
  );
}

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
