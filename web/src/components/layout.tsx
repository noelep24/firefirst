import { useQuery } from '@tanstack/react-query';
import { LogOut, Menu } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';

import { Brand, DepartmentEmblem } from './brand';

import { CalendarFeedButton } from './calendar-feed';
import { SECTION_GROUPS } from './sections';
import { Badge, Button } from './ui';

export function Layout() {
  const { me, isAdmin, logout } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    // Close the mobile menu after navigating.
    setLastPath(location.pathname);
    setMenuOpen(false);
  }

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => http.get<Schemas['Dashboard']>('/api/v1/dashboard/'),
    refetchInterval: 60_000,
  });
  const pending = (dashboard.data?.pending_leave_requests ?? 0) + (dashboard.data?.pending_shift_trades ?? 0);
  const department = me.department;
  const name = me.full_name || me.username;

  return (
    <div className="app">
      <div className="mobile-bar">
        <Button variant="ghost" small onClick={() => setMenuOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </Button>
        <Brand />
      </div>
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main">
        <div className="sidebar-head">
          <DepartmentEmblem logo={department?.logo} name={department?.name} size={44} />
          <div className="sidebar-dept">
            <div className="sidebar-dept-name">{department?.name}</div>
            <div className="sidebar-product">FireFirst</div>
          </div>
        </div>
        {SECTION_GROUPS.map((group) => {
          const sections = group.sections.filter((s) => !s.adminOnly || isAdmin);
          if (sections.length === 0) return null;
          return (
            <div key={group.title}>
              <div className="nav-group">{group.title}</div>
              {sections.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  <span className="nav-label">{label}</span>
                  {to === '/approvals' && pending ? (
                    <span aria-label={`${pending} waiting`}>
                      <Badge tone="warning">{pending}</Badge>
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">
              {initials(name)}
            </span>
            <div>
              <div className="sidebar-user-name">{name}</div>
              <div className="muted small">{me.role === 'admin' ? 'Department admin' : 'Officer'}</div>
            </div>
          </div>
          <CalendarFeedButton />
          <Button small onClick={logout}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
