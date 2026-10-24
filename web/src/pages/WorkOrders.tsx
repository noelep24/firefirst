import type { Schemas } from '@/api/http';
import { CrudPage } from '@/components/crud';
import { priorities, useStationFilter, workOrderFields, workOrderStatuses } from '@/lib/fields';

import { workOrderColumns } from './ApparatusDetail';

export default function WorkOrders() {
  const stationFilter = useStationFilter();
  return (
    <CrudPage<Schemas['WorkOrder']>
      title="Work orders"
      subtitle="Repairs across the fleet. Crews report problems from the mobile app; rig-check deficiencies open one automatically."
      noun="work order"
      endpoint="/api/v1/work-orders/"
      fields={workOrderFields({ withApparatus: true })}
      defaults={{ priority: 'normal', status: 'open' }}
      filters={[
        ...stationFilter,
        { name: 'status', label: 'Status', options: workOrderStatuses },
        { name: 'priority', label: 'Priority', options: priorities },
      ]}
      columns={[{ header: 'Unit', cell: (w) => <strong>{w.apparatus_unit}</strong> }, ...workOrderColumns]}
    />
  );
}
