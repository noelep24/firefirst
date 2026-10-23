import type { Schemas } from '@/api/http';
import { CrudPage } from '@/components/crud';

export default function Stations() {
  return (
    <CrudPage<Schemas['Station']>
      title="Stations"
      noun="station"
      endpoint="/api/v1/stations/"
      columns={[
        { header: 'Number', cell: (s) => s.number },
        { header: 'Name', cell: (s) => s.name },
        { header: 'Address', cell: (s) => s.address },
        { header: 'Phone', cell: (s) => s.phone },
      ]}
      fields={[
        { name: 'number', label: 'Station number', type: 'text', required: true },
        { name: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Headquarters' },
        { name: 'address', label: 'Address', type: 'text', wide: true },
        { name: 'phone', label: 'Phone', type: 'text' },
      ]}
    />
  );
}
