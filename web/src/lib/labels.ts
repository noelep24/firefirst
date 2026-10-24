import type { Schemas } from '@/api/http';

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

export const apparatusTypes: { value: string; label: string }[] = [
  { value: 'engine', label: 'Engine' },
  { value: 'ladder', label: 'Ladder / Truck' },
  { value: 'quint', label: 'Quint' },
  { value: 'rescue', label: 'Rescue / Squad' },
  { value: 'ambulance', label: 'Ambulance / Medic' },
  { value: 'brush', label: 'Brush' },
  { value: 'tender', label: 'Tender / Tanker' },
  { value: 'hazmat', label: 'Hazmat' },
  { value: 'command', label: 'Command / Staff' },
  { value: 'utility', label: 'Utility' },
  { value: 'other', label: 'Other' },
];

export const itemCategories: { value: string; label: string }[] = [
  { value: 'uniforms', label: 'Station uniforms' },
  { value: 'fire_gear', label: 'Structure fire & tech rescue gear' },
  { value: 'medical', label: 'Medical supplies' },
  { value: 'equipment', label: 'Apparatus equipment' },
  { value: 'other', label: 'Station & other supplies' },
];

export const eventCategories: { value: string; label: string }[] = [
  { value: 'training', label: 'Training' },
  { value: 'drill', label: 'Drill' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'inspection', label: 'Inspection / pre-plan' },
  { value: 'public_ed', label: 'Public education' },
  { value: 'community', label: 'Community event' },
  { value: 'maintenance', label: 'Maintenance / station duty' },
  { value: 'other', label: 'Other' },
];

export const positions: { value: string; label: string }[] = [
  { value: 'chief', label: 'Battalion / Shift chief' },
  { value: 'captain', label: 'Captain' },
  { value: 'lieutenant', label: 'Lieutenant' },
  { value: 'engineer', label: 'Engineer / Driver-operator' },
  { value: 'firefighter', label: 'Firefighter' },
  { value: 'paramedic', label: 'Paramedic' },
  { value: 'emt', label: 'EMT' },
];

export const roles: { value: string; label: string }[] = [
  { value: 'member', label: 'Member' },
  { value: 'officer', label: 'Officer' },
  { value: 'admin', label: 'Department admin' },
];

export const labelFor = (options: { value: string; label: string }[], value: string | null | undefined) =>
  options.find((o) => o.value === value)?.label ?? value ?? '';
