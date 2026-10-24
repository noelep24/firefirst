import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { StationBoard } from '@/components/station-board';
import { Badge, Card, DataTable, Empty, PageHeader, QueryState } from '@/components/ui';
import { formatDateTime, formatDay } from '@/lib/format';
import { labelFor, eventCategories } from '@/lib/labels';

export default function Dashboard() {
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => http.get<Schemas['Dashboard']>('/api/v1/dashboard/'),
  });
  const due = useQuery({
    queryKey: ['/api/v1/maintenance-schedules/due/'],
    queryFn: () => http.get<Schemas['MaintenanceSchedule'][]>('/api/v1/maintenance-schedules/due/', { days: 14 }),
  });
  const workOrders = useQuery({
    queryKey: ['/api/v1/work-orders/', { open: true }],
    queryFn: () => getAll<Schemas['WorkOrder']>('/api/v1/work-orders/', { open: true, ordering: '-created_at' }),
  });

  return (
    <div className="stack">
      <QueryState query={dashboard}>
        {(d) => (
          <>
            <PageHeader
              title="Today"
              subtitle={d.platoon_on_duty ? `${d.platoon_on_duty} Shift on duty` : 'No rotation set up'}
            />
            <StationBoard />
            <h2>Department</h2>
            <div className="grid">
              <StatLink to="/apparatus" label="Rigs out of service" value={d.apparatus_out_of_service.length} danger />
              <StatLink to="/work-orders" label="Open work orders" value={d.open_work_orders} />
              <StatLink to="/apparatus" label="Maintenance due (14 days)" value={d.maintenance_due} />
              <StatLink to="/inventory" label="Stock below par" value={d.stock_below_par} />
              <StatLink to="/inventory" label="Expiring within 30 days" value={d.stock_expiring_30_days} danger />
              <StatLink
                to="/approvals"
                label="Waiting for your approval"
                value={(d.pending_leave_requests ?? 0) + (d.pending_shift_trades ?? 0)}
              />
              <StatLink
                to="/schedule"
                label="Short-staffed days (next 7)"
                value={d.staffing_shortfall_days.length}
                danger
              />
              <StatLink
                to="/certifications"
                label="Certifications expiring or expired"
                value={d.certifications_needing_attention}
              />
            </div>
            {d.apparatus_out_of_service.length ? (
              <Card>
                <div className="row">
                  <strong className="tone-danger">Out of service:</strong>
                  {d.apparatus_out_of_service.map((rig) => (
                    <Link key={rig.id} to={`/apparatus/${rig.id}`}>
                      <Badge tone="danger">{rig.unit_number}</Badge>
                    </Link>
                  ))}
                </div>
              </Card>
            ) : null}
          </>
        )}
      </QueryState>

      <div className="grid-2">
        <section className="stack-sm">
          <h2>Open work orders</h2>
          <QueryState query={workOrders}>
            {(rows) => (
              <DataTable
                rows={rows.slice(0, 8)}
                empty="No open work orders."
                columns={[
                  {
                    header: 'Unit',
                    cell: (w) => <Link to={`/apparatus/${w.apparatus}`}>{w.apparatus_unit}</Link>,
                  },
                  { header: 'Problem', cell: (w) => w.title },
                  {
                    header: 'Priority',
                    cell: (w) => (
                      <Badge
                        tone={w.priority === 'critical' ? 'danger' : w.priority === 'high' ? 'warning' : 'neutral'}>
                        {w.priority}
                      </Badge>
                    ),
                  },
                ]}
              />
            )}
          </QueryState>
        </section>
        <section className="stack-sm">
          <h2>Maintenance due</h2>
          <QueryState query={due}>
            {(rows) => (
              <DataTable
                rows={rows.slice(0, 8)}
                empty="Nothing due in the next two weeks."
                columns={[
                  {
                    header: 'Unit',
                    cell: (s) => <Link to={`/apparatus/${s.apparatus}`}>{s.apparatus_unit}</Link>,
                  },
                  { header: 'Task', cell: (s) => s.task },
                  {
                    header: 'Due',
                    cell: (s) =>
                      s.next_due_date
                        ? formatDay(s.next_due_date)
                        : s.last_performed_on
                          ? 'By mileage/hours'
                          : 'Never done',
                  },
                ]}
              />
            )}
          </QueryState>
        </section>
      </div>

      <section className="stack-sm">
        <h2>Next 7 days</h2>
        <QueryState query={dashboard}>
          {(d) =>
            d.upcoming_events.length === 0 ? (
              <Empty>Nothing scheduled.</Empty>
            ) : (
              <DataTable
                rows={d.upcoming_events}
                columns={[
                  { header: 'When', cell: (e) => formatDateTime(e.starts_at) },
                  { header: 'Event', cell: (e) => <Link to={`/events?open=${e.id}`}>{e.title}</Link> },
                  { header: 'Type', cell: (e) => labelFor(eventCategories, e.category) },
                  { header: '', cell: (e) => (e.is_mandatory ? <Badge tone="danger">Mandatory</Badge> : null) },
                ]}
              />
            )
          }
        </QueryState>
      </section>
    </div>
  );
}

function StatLink({ to, label, value, danger }: { to: string; label: string; value: number; danger?: boolean }) {
  return (
    <Link to={to} className="card card-link">
      <div className={`stat-value ${value ? (danger ? 'tone-danger' : 'tone-warning') : ''}`}>{value}</div>
      <div className="muted small">{label}</div>
    </Link>
  );
}
