import type { Schemas } from '@/api/client';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const apparatusStatus: Record<Schemas['Apparatus']['status'] & string, { label: string; tone: Tone }> = {
  in_service: { label: 'In service', tone: 'success' },
  limited: { label: 'Limited', tone: 'warning' },
  out_of_service: { label: 'Out of service', tone: 'danger' },
  reserve: { label: 'Reserve', tone: 'neutral' },
};

export const workOrderStatus: Record<Schemas['WorkOrder']['status'] & string, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'warning' },
  waiting_parts: { label: 'Waiting on parts', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const priorityTone: Record<Schemas['WorkOrder']['priority'] & string, Tone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  critical: 'danger',
};

export const requestStatus: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  pending_partner: { label: 'Waiting on partner', tone: 'warning' },
  pending_approval: { label: 'Waiting on officer', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  denied: { label: 'Denied', tone: 'danger' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const leaveTypes: { value: Schemas['LeaveRequestRequest']['leave_type']; label: string }[] = [
  { value: 'vacation', label: 'Vacation' },
  { value: 'sick', label: 'Sick' },
  { value: 'personal', label: 'Personal' },
  { value: 'kelly', label: 'Kelly day' },
  { value: 'training', label: 'Training / detail' },
  { value: 'bereavement', label: 'Bereavement' },
  { value: 'injury', label: 'On-duty injury' },
  { value: 'other', label: 'Other' },
];

export const leaveTypeLabel = (value: string) => leaveTypes.find((t) => t.value === value)?.label ?? value;

export const positionLabels: Record<string, string> = {
  chief: 'Shift chief',
  captain: 'Captain',
  lieutenant: 'Lieutenant',
  engineer: 'Engineer',
  firefighter: 'Firefighter',
  paramedic: 'Paramedic',
  emt: 'EMT',
};

export const positionLabel = (value: string | null | undefined) => (value ? (positionLabels[value] ?? value) : '');

export const dutyStatus: Record<string, { label: string; tone: Tone }> = {
  on_duty: { label: 'On duty', tone: 'success' },
  covering: { label: 'On duty · trade', tone: 'success' },
  on_leave: { label: 'On leave', tone: 'neutral' },
  traded_off: { label: 'Traded off', tone: 'neutral' },
  off_duty: { label: 'Off duty', tone: 'neutral' },
};
