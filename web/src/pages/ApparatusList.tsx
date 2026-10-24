import { useNavigate } from 'react-router';

import type { Schemas } from '@/api/http';
import { CrudPage } from '@/components/crud';
import type { FieldSpec } from '@/components/form';
import { Badge } from '@/components/ui';
import { stationLabel, useStationFilter } from '@/lib/fields';
import { apparatusStatus, apparatusTypes, labelFor } from '@/lib/labels';

export const apparatusFields: FieldSpec[] = [
  { name: 'unit_number', label: 'Unit number', type: 'text', required: true, placeholder: 'e.g. E1' },
  { name: 'apparatus_type', label: 'Type', type: 'select', options: apparatusTypes, required: true },
  {
    name: 'station',
    label: 'Station',
    type: 'relation',
    endpoint: '/api/v1/stations/',
    optionLabel: stationLabel as (row: never) => string,
  },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    required: true,
    options: Object.entries(apparatusStatus).map(([value, s]) => ({ value, label: s.label })),
  },
  { name: 'year', label: 'Year', type: 'number', step: '1' },
  { name: 'make', label: 'Make', type: 'text' },
  { name: 'model', label: 'Model', type: 'text' },
  { name: 'vin', label: 'VIN', type: 'text' },
  { name: 'license_plate', label: 'License plate', type: 'text' },
  { name: 'mileage', label: 'Mileage', type: 'number', step: '1', min: 0 },
  { name: 'engine_hours', label: 'Engine hours', type: 'number', step: '0.1', min: 0 },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export default function ApparatusList() {
  const navigate = useNavigate();
  const stationFilter = useStationFilter();
  return (
    <CrudPage<Schemas['Apparatus']>
      title="Apparatus"
      subtitle="Your fleet. Open a unit to see its checks, work orders and maintenance."
      noun="apparatus"
      endpoint="/api/v1/apparatus/"
      fields={apparatusFields}
      defaults={{ status: 'in_service', apparatus_type: 'engine', mileage: '0', engine_hours: '0' }}
      onRowClick={(a) => navigate(`/apparatus/${a.id}`)}
      filters={[
        ...stationFilter,
        {
          name: 'status',
          label: 'Status',
          options: Object.entries(apparatusStatus).map(([value, s]) => ({ value, label: s.label })),
        },
        { name: 'apparatus_type', label: 'Type', options: apparatusTypes },
      ]}
      columns={[
        { header: 'Unit', cell: (a) => <strong>{a.unit_number}</strong> },
        { header: 'Type', cell: (a) => labelFor(apparatusTypes, a.apparatus_type) },
        { header: 'Station', cell: (a) => a.station_name },
        {
          header: 'Status',
          cell: (a) => {
            const s = apparatusStatus[a.status ?? 'in_service'];
            return <Badge tone={s.tone}>{s.label}</Badge>;
          },
        },
        { header: 'Open work orders', cell: (a) => a.open_work_orders || '', className: 'num' },
        { header: 'Mileage', cell: (a) => (a.mileage ?? 0).toLocaleString(), className: 'num' },
        { header: 'Year / make / model', cell: (a) => [a.year, a.make, a.model].filter(Boolean).join(' ') },
      ]}
    />
  );
}
