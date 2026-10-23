import {
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  Flame,
  GraduationCap,
  History,
  House,
  ListChecks,
  type LucideIcon,
  Package,
  Settings,
  Sunrise,
  Truck,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';

import type { Schemas } from '@/api/http';

type Tone = 'neutral' | 'warning' | 'danger';

export type Section = {
  to: string;
  label: string;
  /** One line for the home page tile. */
  description: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Hidden from the home page tiles (Home itself). */
  navOnly?: boolean;
  /** What needs attention here, from the dashboard numbers. Nothing when all is well. */
  alert?: (d: Schemas['Dashboard']) => { text: string; tone: Tone } | null;
};

function count(value: number, text: string, tone: Tone = 'warning') {
  return value ? { text: `${value} ${text}`, tone } : null;
}

/**
 * Every area of the officer app, grouped as the menu shows them. The home page shows the first three groups as
 * tiles; the Admin group sits behind one Admin tile.
 */
export const SECTION_GROUPS: { title: string; sections: Section[] }[] = [
  {
    title: 'Overview',
    sections: [
      { to: '/', label: 'Home', description: '', icon: House, navOnly: true },
      {
        to: '/today',
        label: 'Today',
        description: "Who's riding what, station by station",
        icon: Sunrise,
        alert: (d) => (d.platoon_on_duty ? { text: `${d.platoon_on_duty} Shift on duty`, tone: 'neutral' } : null),
      },
      { to: '/reports', label: 'Reports', description: 'Staffing, fleet and training reports', icon: ChartColumn },
    ],
  },
  {
    title: 'Operations',
    sections: [
      { to: '/incidents', label: 'Incidents', description: 'NERIS fire reports and run log', icon: Flame },
      {
        to: '/apparatus',
        label: 'Apparatus',
        description: 'Rigs, status, moves and maintenance',
        icon: Truck,
        alert: (d) => count(d.apparatus_out_of_service.length, 'out of service', 'danger'),
      },
      {
        to: '/work-orders',
        label: 'Work orders',
        description: 'Repairs reported from the floor',
        icon: Wrench,
        alert: (d) => count(d.open_work_orders, 'open'),
      },
      {
        to: '/inventory',
        label: 'Inventory',
        description: 'Station stock, par levels and expirations',
        icon: Package,
        alert: (d) => count(d.stock_below_par, 'below par'),
      },
      {
        to: '/schedule',
        label: 'Schedule',
        description: 'Shift calendar, assignments and overtime',
        icon: CalendarDays,
        alert: (d) => count(d.staffing_shortfall_days.length, 'short-staffed days', 'danger'),
      },
      {
        to: '/approvals',
        label: 'Approvals',
        description: 'Leave requests and shift trades',
        icon: ClipboardCheck,
        alert: (d) => count((d.pending_leave_requests ?? 0) + (d.pending_shift_trades ?? 0), 'waiting'),
      },
      {
        to: '/events',
        label: 'Events & training',
        description: 'Drills, classes and department events',
        icon: GraduationCap,
        alert: (d) => count(d.upcoming_events.length, 'this week', 'neutral'),
      },
    ],
  },
  {
    title: 'Setup',
    sections: [
      {
        to: '/checklists',
        label: 'Rig checklists',
        description: 'Daily and weekly apparatus checks',
        icon: ListChecks,
      },
      {
        to: '/people',
        label: 'People',
        description: 'Roster, ranks and certifications',
        icon: Users,
        alert: (d) => count(d.certifications_needing_attention, 'certifications due'),
      },
    ],
  },
  {
    title: 'Admin',
    sections: [
      {
        to: '/stations',
        label: 'Stations',
        description: 'Firehouses and their addresses',
        icon: Building2,
        adminOnly: true,
      },
      {
        to: '/import',
        label: 'Import data',
        description: 'Bring records over from ESO or spreadsheets',
        icon: Upload,
        adminOnly: true,
      },
      { to: '/audit', label: 'Audit log', description: 'Who changed what, and when', icon: History, adminOnly: true },
      {
        to: '/settings',
        label: 'Department settings',
        description: 'Name, logo, time zone and NERIS ID',
        icon: Settings,
        adminOnly: true,
      },
    ],
  },
];
