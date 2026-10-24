import { useQuery } from '@tanstack/react-query';

import { getAll, type Schemas } from '@/api/http';
import type { Filter } from '@/components/crud';
import type { FieldSpec } from '@/components/form';

import { workOrderStatus } from './labels';

export const stationLabel = (s: Schemas['Station']) => `Station ${s.number}${s.name ? ` – ${s.name}` : ''}`;
export const personLabel = (u: Schemas['User']) => [u.rank, u.full_name || u.username].filter(Boolean).join(' ');

export const priorities = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const workOrderStatuses = Object.entries(workOrderStatus).map(([value, s]) => ({ value, label: s.label }));

export function workOrderFields({ withApparatus }: { withApparatus: boolean }): FieldSpec[] {
  const fields: FieldSpec[] = [
    { name: 'title', label: 'Problem', type: 'text', required: true, wide: true },
    { name: 'description', label: 'Details', type: 'textarea' },
    { name: 'priority', label: 'Priority', type: 'select', options: priorities, required: true },
    { name: 'status', label: 'Status', type: 'select', options: workOrderStatuses, required: true },
    { name: 'assigned_to', label: 'Assigned to', type: 'text', placeholder: 'Mechanic, shop or vendor' },
    { name: 'cost', label: 'Cost ($)', type: 'number', step: '0.01', min: 0 },
    {
      name: 'takes_out_of_service',
      label: 'Out of service until fixed',
      type: 'checkbox',
      help: 'While open, the rig shows as out of service everywhere.',
      wide: true,
    },
    { name: 'resolution', label: 'Resolution', type: 'textarea' },
  ];
  if (withApparatus) {
    fields.unshift({
      name: 'apparatus',
      label: 'Apparatus',
      type: 'relation',
      required: true,
      endpoint: '/api/v1/apparatus/',
      optionLabel: ((a: Schemas['Apparatus']) => a.unit_number) as (row: never) => string,
    });
  }
  return fields;
}

export const maintenanceFields: FieldSpec[] = [
  { name: 'task', label: 'Task', type: 'text', required: true, wide: true, placeholder: 'e.g. Annual pump test' },
  { name: 'interval_days', label: 'Every (days)', type: 'number', step: '1', min: 1 },
  { name: 'interval_miles', label: 'Every (miles)', type: 'number', step: '1', min: 1 },
  { name: 'interval_hours', label: 'Every (engine hours)', type: 'number', step: '0.1', min: 0.1 },
  { name: 'last_performed_on', label: 'Last done', type: 'date' },
  { name: 'last_mileage', label: 'Mileage when last done', type: 'number', step: '1', min: 0 },
  { name: 'last_engine_hours', label: 'Engine hours when last done', type: 'number', step: '0.1', min: 0 },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export const serviceRecordFields: FieldSpec[] = [
  { name: 'description', label: 'Work performed', type: 'text', required: true, wide: true },
  { name: 'performed_on', label: 'Date', type: 'date', required: true },
  { name: 'performed_by', label: 'Performed by', type: 'text', placeholder: 'Mechanic, shop or vendor' },
  { name: 'mileage', label: 'Mileage', type: 'number', step: '1', min: 0 },
  { name: 'engine_hours', label: 'Engine hours', type: 'number', step: '0.1', min: 0 },
  { name: 'cost', label: 'Cost ($)', type: 'number', step: '0.01', min: 0 },
  {
    name: 'passed',
    label: 'Result',
    type: 'select',
    options: [
      { value: 'true', label: 'Passed' },
      { value: 'false', label: 'Failed' },
    ],
    help: 'For tests such as pump or ladder tests',
  },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

/** A "Station" filter for list pages, once the stations have loaded (none for a one-station department). */
export function useStationFilter(): Filter[] {
  const stations = useQuery({
    queryKey: ['/api/v1/stations/'],
    queryFn: () => getAll<Schemas['Station']>('/api/v1/stations/'),
    staleTime: 5 * 60_000,
  });
  if (!stations.data || stations.data.length < 2) return [];
  const options = stations.data.map((s) => ({ value: String(s.id), label: stationLabel(s) }));
  return [{ name: 'station', label: 'Station', options }];
}
