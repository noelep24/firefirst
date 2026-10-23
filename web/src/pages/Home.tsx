import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { DepartmentEmblem, MalteseCross } from '@/components/brand';
import { OnboardingCard } from '@/components/onboarding';
import { SECTION_GROUPS } from '@/components/sections';

/** The landing page: the department's emblem behind a tile for every area of the app. */
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

  return (
    <div className="home">
      <div className="home-backdrop" aria-hidden="true">
        {department?.logo ? <img src={department.logo} alt="" /> : <MalteseCross size={640} />}
      </div>

      <header className="home-hero">
        <DepartmentEmblem logo={department?.logo} name={department?.name} size={88} />
        <div className="stack-sm">
          <div className="home-eyebrow">
            {today}
            {onDuty ? ` · ${onDuty} Shift on duty` : ''}
          </div>
          <h1>{department?.name}</h1>
          <p className="muted">
            {greeting(now)}, {firstName}.
          </p>
        </div>
      </header>

      <OnboardingCard />
      {isAdmin && !department?.logo ? (
        <Link to="/settings" className="home-hint">
          Add your department's patch or logo in Department settings. It will appear here and in the menu.
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      ) : null}

      {SECTION_GROUPS.map((group) => {
        const sections = group.sections.filter((s) => !s.navOnly && (!s.adminOnly || isAdmin));
        if (sections.length === 0) return null;
        return (
          <section key={group.title} className="stack-sm">
            <h2 className="home-group">{group.title}</h2>
            <div className="tile-grid">
              {sections.map(({ to, label, description, icon: Icon, alert }) => {
                const status = dashboard.data && alert ? alert(dashboard.data) : null;
                return (
                  <Link key={to} to={to} className="tile">
                    <span className="tile-icon">
                      <Icon size={28} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                    <span className="tile-text">
                      <span className="tile-label">{label}</span>
                      <span className="tile-description">{description}</span>
                      {status ? <span className={`tile-status tone-${status.tone}`}>{status.text}</span> : null}
                    </span>
                    <ChevronRight className="tile-arrow" size={20} aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function greeting(now: Date) {
  const hour = now.getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}
