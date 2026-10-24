import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { DepartmentEmblem, MalteseCross } from '@/components/brand';
import { OnboardingCard } from '@/components/onboarding';
import { AREAS } from '@/components/sections';
import { StationBoard } from '@/components/station-board';
import { AreaLinks } from '@/components/tiles';

/** The landing page: today's station board, with every area of the app down the right, over the department's patch. */
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
  const [showAll, setShowAll] = useState(false);
  // Today is the section on the left, so its link isn't repeated on the right. Admins see only areas with
  // something due; the menu still reaches the rest.
  const others = AREAS.filter((a) => a.key !== 'today');
  const due = dashboard.data
    ? others.filter((a) => (a.alerts?.(dashboard.data) ?? []).some((x) => x && x.tone !== 'neutral'))
    : [];
  const areas = isAdmin && !showAll ? due : others;

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
      {isAdmin && !department?.logo_url ? (
        <Link to="/settings" className="home-hint">
          Add your department's patch or logo in Settings.
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ) : null}

      <div className="home-layout">
        <section className="home-today" aria-labelledby="today-title">
          <div className="row spread">
            <h2 id="today-title">Today</h2>
            <Link to="/today" className="muted small">
              Department overview ›
            </Link>
          </div>
          <StationBoard />
        </section>
        <div className="home-side stack-sm">
          <AreaLinks areas={areas} dashboard={dashboard.data} />
          {isAdmin && dashboard.data && due.length === 0 && !showAll ? (
            <div className="area-links-clear">All clear: nothing is due.</div>
          ) : null}
          {isAdmin ? (
            <button type="button" className="link-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show only what needs attention' : 'Show all areas'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
