import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';

import { CalendarFeedButton } from './calendar-feed';
import { Badge, Button } from './ui';

type NavItem = { to: string; label: string; adminOnly?: boolean; badge?: number };

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

  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: 'Overview',
      items: [
        { to: '/', label: 'Dashboard' },
        { to: '/reports', label: 'Reports' },
      ],
    },
    {
      title: 'Operations',
      items: [
        { to: '/apparatus', label: 'Apparatus' },
        { to: '/work-orders', label: 'Work orders' },
        { to: '/inventory', label: 'Inventory' },
        { to: '/schedule', label: 'Schedule' },
        { to: '/approvals', label: 'Approvals', badge: pending },
        { to: '/events', label: 'Events & training' },
      ],
    },
    {
      title: 'Setup',
      items: [
        { to: '/checklists', label: 'Rig checklists' },
        { to: '/people', label: 'People' },
        { to: '/stations', label: 'Stations', adminOnly: true },
      ],
    },
    {
      title: 'Admin',
      items: [
        { to: '/import', label: 'Import data', adminOnly: true },
        { to: '/audit', label: 'Audit log', adminOnly: true },
        { to: '/settings', label: 'Department settings', adminOnly: true },
      ],
    },
  ];

  return (
    <div className="app">
      <div className="mobile-bar">
        <Button variant="ghost" small onClick={() => setMenuOpen(true)} aria-label="Open menu">
          ☰
        </Button>
        <strong className="brand" style={{ padding: 0 }}>
          FireFirst
        </strong>
      </div>
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`} aria-label="Main">
        <div className="brand">FireFirst</div>
        <div className="brand-sub">{me.department?.name}</div>
        {groups.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <div className="nav-group">{group.title}</div>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <span>{item.label}</span>
                  {item.badge ? (
                    <span aria-label={`${item.badge} waiting`}>
                      <Badge tone="warning">{item.badge}</Badge>
                    </span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          );
        })}
        <div className="sidebar-footer">
          <div>
            <div style={{ fontWeight: 600 }}>{me.full_name || me.username}</div>
            <div className="muted small">{me.role === 'admin' ? 'Department admin' : 'Officer'}</div>
          </div>
          <CalendarFeedButton />
          <Button small onClick={logout}>
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
