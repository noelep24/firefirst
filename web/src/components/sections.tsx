import {
  CalendarDays,
  ChartColumn,
  Flame,
  GraduationCap,
  type LucideIcon,
  Package,
  ShieldCheck,
  Sunrise,
  Truck,
} from 'lucide-react';

import type { Schemas } from '@/api/http';

type Tone = 'neutral' | 'warning' | 'danger';

export type Page = { to: string; label: string; adminOnly?: boolean };

export type Area = {
  key: string;
  label: string;
  /** One line for the home page tile. */
  description: string;
  icon: LucideIcon;
  /** The area's pages, shown as tabs across the top of each. The tile opens the first one you can see. */
  pages: Page[];
  /** What needs attention here, from the dashboard numbers. Nothing when all is well. */
  alerts?: (d: Schemas['Dashboard']) => ({ text: string; tone: Tone } | null)[];
};

function count(value: number, text: string, tone: Tone = 'warning') {
  return value ? { text: `${value} ${text}`, tone } : null;
}

/** The eight areas of the officer app: the home page tiles, the menu, and the tabs across each area's pages. */
export const AREAS: Area[] = [
  {
    key: 'today',
    label: 'Today',
    description: "Who's riding what, station by station",
    icon: Sunrise,
    pages: [{ to: '/today', label: 'Today' }],
    alerts: (d) => [d.platoon_on_duty ? { text: `${d.platoon_on_duty} Shift on duty`, tone: 'neutral' } : null],
  },
  {
    key: 'incidents',
    label: 'Incidents',
    description: 'NERIS fire reports and run log',
    icon: Flame,
    pages: [{ to: '/incidents', label: 'Incidents' }],
  },
  {
    key: 'fleet',
    label: 'Fleet',
    description: 'Apparatus, work orders and rig checks',
    icon: Truck,
    pages: [
      { to: '/apparatus', label: 'Apparatus' },
      { to: '/work-orders', label: 'Work orders' },
      { to: '/checklists', label: 'Rig checks' },
    ],
    alerts: (d) => [
      count(d.apparatus_out_of_service.length, 'out of service', 'danger'),
      count(d.open_work_orders, 'open work orders'),
      count(d.maintenance_due, 'maintenance due'),
    ],
  },
  {
    key: 'staffing',
    label: 'Staffing',
    description: 'Schedule, overtime and approvals',
    icon: CalendarDays,
    pages: [
      { to: '/schedule', label: 'Schedule' },
      { to: '/approvals', label: 'Approvals' },
    ],
    alerts: (d) => [
      count((d.pending_leave_requests ?? 0) + (d.pending_shift_trades ?? 0), 'waiting for approval'),
      count(d.staffing_shortfall_days.length, 'short-staffed days', 'danger'),
    ],
  },
  {
    key: 'supplies',
    label: 'Supplies',
    description: 'Uniforms, gear, medical and equipment stock',
    icon: Package,
    pages: [
      { to: '/supplies/uniforms', label: 'Uniforms' },
      { to: '/supplies/fire-gear', label: 'Fire & tech gear' },
      { to: '/supplies/medical', label: 'Medical' },
      { to: '/supplies/equipment', label: 'Apparatus equipment' },
      { to: '/supplies/other', label: 'Station & other' },
      { to: '/supplies/locations', label: 'Storage locations' },
      { to: '/supplies/activity', label: 'Activity' },
    ],
    alerts: (d) => [count(d.stock_below_par, 'below par'), count(d.stock_expiring_30_days, 'expiring', 'danger')],
  },
  {
    key: 'training',
    label: 'Training',
    description: 'Drills, classes and certifications',
    icon: GraduationCap,
    pages: [
      { to: '/events', label: 'Events & training' },
      { to: '/certifications', label: 'Certifications' },
    ],
    alerts: (d) => [
      count(d.certifications_needing_attention, 'certifications due'),
      count(d.upcoming_events.length, 'events this week', 'neutral'),
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    description: 'Staffing, fleet and training reports',
    icon: ChartColumn,
    pages: [{ to: '/reports', label: 'Reports' }],
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'People, stations, settings and records',
    icon: ShieldCheck,
    pages: [
      { to: '/people', label: 'People' },
      { to: '/stations', label: 'Stations', adminOnly: true },
      { to: '/settings', label: 'Settings', adminOnly: true },
      { to: '/import', label: 'Import data', adminOnly: true },
      { to: '/audit', label: 'Audit log', adminOnly: true },
    ],
  },
];

export function visiblePages(area: Area, isAdmin: boolean) {
  return area.pages.filter((p) => !p.adminOnly || isAdmin);
}

/** The area a path belongs to (a page or anything under it, e.g. /apparatus/12). */
export function areaFor(pathname: string) {
  return AREAS.find((a) => a.pages.some((p) => pathname === p.to || pathname.startsWith(`${p.to}/`)));
}
