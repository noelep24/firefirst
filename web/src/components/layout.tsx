import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, LogOut, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';

import { DepartmentEmblem } from './brand';

import { CalendarFeedButton } from './calendar-feed';
import { NotificationsBell } from './notifications';
import { SECTION_GROUPS } from './sections';
import { Button } from './ui';

/**
 * The menu stays out of the way until it's wanted: it slides in when the pointer reaches the left edge of the
 * screen (and away again when it leaves), or from the Menu button, where it stays until you pick a page or close it.
 */
type MenuState = 'closed' | 'peek' | 'open';

export function Layout() {
  const { me } = useMe();
  const [menu, setMenu] = useState<MenuState>('closed');
  const location = useLocation();
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    // Close the menu after navigating.
    setLastPath(location.pathname);
    setMenu('closed');
  }
  useEffect(() => {
    if (menu !== 'peek') return;
    // A peek closes once the pointer moves well clear of the menu.
    const onMove = (e: MouseEvent) => {
      const edge = document.getElementById('main-menu')?.getBoundingClientRect().right ?? 0;
      if (e.clientX > edge + 24) setMenu('closed');
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [menu]);
  useEffect(() => {
    if (menu === 'closed') return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu('closed');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => http.get<Schemas['Dashboard']>('/api/v1/dashboard/'),
    refetchInterval: 60_000,
  });
  const pending = (dashboard.data?.pending_leave_requests ?? 0) + (dashboard.data?.pending_shift_trades ?? 0);
  const department = me.department;

  return (
    <div className="app">
      <header className="topbar">
        <Button
          variant="ghost"
          small
          onClick={() => setMenu(menu === 'open' ? 'closed' : 'open')}
          aria-expanded={menu !== 'closed'}
          aria-controls="main-menu">
          <Menu size={20} aria-hidden="true" />
          Menu
        </Button>
        <Link to="/" className="topbar-home">
          <DepartmentEmblem logo={department?.logo} name={department?.name} size={30} />
          <span>{department?.name}</span>
        </Link>
        <div className="topbar-end">
          {pending ? (
            <Link to="/approvals" className="topbar-pill" aria-label={`${pending} waiting for approval`}>
              <ClipboardCheck size={18} aria-hidden="true" />
              {pending}
            </Link>
          ) : null}
          <NotificationsBell />
          <UserMenu />
        </div>
      </header>

      {/* Reaching the left edge of the screen slides the menu in. */}
      <div className="menu-edge" aria-hidden="true" onMouseEnter={() => menu === 'closed' && setMenu('peek')} />
      {menu === 'open' ? <div className="menu-scrim" onClick={() => setMenu('closed')} aria-hidden="true" /> : null}
      <nav
        id="main-menu"
        className={`sidebar ${menu !== 'closed' ? 'open' : ''}`}
        aria-label="Main"
        inert={menu === 'closed'}>
        <div className="sidebar-head">
          <span className="sidebar-product">FireFirst</span>
          <Button variant="ghost" small onClick={() => setMenu('closed')} aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        <Navigation pending={pending} />
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}

function Navigation({ pending }: { pending: number }) {
  const { isAdmin } = useMe();
  return (
    <>
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
                <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                <span className="nav-label">{label}</span>
                {to === '/approvals' && pending ? (
                  <span className="nav-count" aria-label={`${pending} waiting`}>
                    {pending}
                  </span>
                ) : null}
              </NavLink>
            ))}
          </div>
        );
      })}
    </>
  );
}

function UserMenu() {
  const { me, logout } = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const name = me.full_name || me.username;

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true">
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="user-button-name">{name}</span>
      </button>
      {open ? (
        <div className="user-popover" role="menu">
          <div>
            <div className="user-name">{name}</div>
            <div className="muted small">{me.role === 'admin' ? 'Department admin' : 'Officer'}</div>
          </div>
          <CalendarFeedButton />
          <Button small variant="ghost" onClick={logout}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}
