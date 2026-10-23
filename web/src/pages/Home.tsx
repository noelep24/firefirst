import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleCheck, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { DepartmentEmblem, MalteseCross } from '@/components/brand';
import { OnboardingCard } from '@/components/onboarding';
import { SECTION_GROUPS } from '@/components/sections';
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

  const groups = SECTION_GROUPS.filter((g) => g.title !== 'Admin').map((g) => ({
    ...g,
    sections: g.sections.filter((s) => !s.navOnly && (!s.adminOnly || isAdmin)),
  }));
  if (isAdmin) {
    groups[groups.length - 1].sections.push({
      to: '/admin',
      label: 'Admin',
      description: '',
      icon: ShieldCheck,
    });
  }
  // Only what someone has to act on: warnings and problems, not information.
  const attention = dashboard.data
    ? SECTION_GROUPS.flatMap((g) => g.sections)
        .filter((s) => !s.adminOnly || isAdmin)
        .map((s) => ({ section: s, status: s.alert?.(dashboard.data) }))
        .filter((a) => a.status && a.status.tone !== 'neutral')
    : [];

  return (
    <div className="home">
      <div className="home-backdrop" aria-hidden="true">
        {department?.logo ? <img src={department.logo} alt="" /> : <MalteseCross size={640} />}
      </div>

      <header className="home-head">
        <DepartmentEmblem logo={department?.logo} name={department?.name} size={64} />
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
            attention.map(({ section, status }) => (
              <Link key={section.to} to={section.to} className="attention-row">
                <span className={`dot tone-${status!.tone}`} aria-hidden="true" />
                <span className="attention-label">{section.label}</span>
                <span className="muted">{status!.text}</span>
                <ChevronRight size={16} aria-hidden="true" className="attention-arrow" />
              </Link>
            ))
          )}
        </section>
      ) : null}

      {isAdmin && !department?.logo ? (
        <Link to="/settings" className="home-hint">
          Add your department's patch or logo in Department settings.
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ) : null}

      {groups.map((group) =>
        group.sections.length ? (
          <section key={group.title} className="stack-sm">
            <h2 className="group-title">{group.title}</h2>
            <TileGrid sections={group.sections} />
          </section>
        ) : null,
      )}
    </div>
  );
}

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
