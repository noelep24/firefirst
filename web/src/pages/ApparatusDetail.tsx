import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { RecordModal } from '@/components/crud';
import { type FieldSpec, Form, type Values } from '@/components/form';
import { Badge, Button, Card, DataTable, Empty, ErrorBox, Modal, PageHeader, QueryState, Tabs } from '@/components/ui';
import { maintenanceFields, priorities, serviceRecordFields, stationLabel, workOrderFields } from '@/lib/fields';
import { formatDateTime, formatDay, isoDate } from '@/lib/format';
import { apparatusStatus, apparatusTypes, labelFor, priorityTone, workOrderStatus } from '@/lib/labels';

import { apparatusFields } from './ApparatusList';

type Tab = 'work-orders' | 'checks' | 'maintenance' | 'service';

type Editing =
  | { kind: 'apparatus' }
  | { kind: 'move' }
  | { kind: 'work-order'; record: Schemas['WorkOrder'] | null }
  | { kind: 'schedule'; record: Schemas['MaintenanceSchedule'] | null }
  | { kind: 'service'; record: Schemas['ServiceRecord'] | null; schedule?: Schemas['MaintenanceSchedule'] }
  | null;

export default function ApparatusDetail() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('work-orders');
  const [editing, setEditing] = useState<Editing>(null);
  const [inspection, setInspection] = useState<Schemas['Inspection'] | null>(null);

  const rig = useQuery({
    queryKey: ['/api/v1/apparatus/', id],
    queryFn: () => http.get<Schemas['Apparatus']>(`/api/v1/apparatus/${id}/`),
  });

  const saved = () => {
    queryClient.invalidateQueries();
    setEditing(null);
  };

  return (
    <div className="stack">
      <QueryState query={rig}>
        {(r) => {
          const status = apparatusStatus[r.status ?? 'in_service'];
          return (
            <>
              <PageHeader
                title={r.unit_number}
                subtitle={
                  <span className="row">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <span>
                      {[
                        labelFor(apparatusTypes, r.apparatus_type),
                        r.station_name,
                        [r.year, r.make, r.model].filter(Boolean).join(' '),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                }
                actions={
                  <>
                    <Link to="/apparatus" className="btn btn-ghost">
                      All apparatus
                    </Link>
                    <Button onClick={() => setEditing({ kind: 'move' })}>Move</Button>
                    <Button onClick={() => setEditing({ kind: 'apparatus' })}>Edit details</Button>
                  </>
                }
              />
              {r.current_move ? <AwayBanner rig={r} onReturned={saved} /> : null}
              <div className="grid">
                <Card>
                  <div className="stat-value">{(r.mileage ?? 0).toLocaleString()}</div>
                  <div className="muted small">Miles</div>
                </Card>
                <Card>
                  <div className="stat-value">{Number(r.engine_hours ?? 0).toLocaleString()}</div>
                  <div className="muted small">Engine hours</div>
                </Card>
                <Card>
                  <div className={`stat-value ${r.open_work_orders ? 'tone-warning' : ''}`}>
                    {r.open_work_orders ?? 0}
                  </div>
                  <div className="muted small">Open work orders</div>
                </Card>
                <Card>
                  <div className="small">{r.vin ? `VIN ${r.vin}` : 'No VIN on file'}</div>
                  <div className="muted small">{r.license_plate ? `Plate ${r.license_plate}` : ''}</div>
                </Card>
              </div>
              {editing?.kind === 'move' ? <MoveModal rig={r} onClose={() => setEditing(null)} onMoved={saved} /> : null}
              {editing?.kind === 'apparatus' ? (
                <RecordModal<Schemas['Apparatus']>
                  title={`Edit ${r.unit_number}`}
                  endpoint="/api/v1/apparatus/"
                  fields={apparatusFields}
                  record={r}
                  onClose={() => setEditing(null)}
                  onSaved={(result) => (result ? saved() : navigate('/apparatus'))}
                />
              ) : null}
            </>
          );
        }}
      </QueryState>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'work-orders', label: 'Work orders' },
          { value: 'checks', label: 'Rig checks' },
          { value: 'maintenance', label: 'Preventive maintenance' },
          { value: 'service', label: 'Service history' },
        ]}
      />

      {tab === 'work-orders' ? (
        <WorkOrdersTab id={id} onEdit={(record) => setEditing({ kind: 'work-order', record })} />
      ) : null}
      {tab === 'checks' ? <ChecksTab id={id} onOpen={setInspection} /> : null}
      {tab === 'maintenance' ? (
        <MaintenanceTab
          id={id}
          onEdit={(record) => setEditing({ kind: 'schedule', record })}
          onLog={(schedule) => setEditing({ kind: 'service', record: null, schedule })}
        />
      ) : null}
      {tab === 'service' ? <ServiceTab id={id} onEdit={(record) => setEditing({ kind: 'service', record })} /> : null}

      {editing?.kind === 'work-order' ? (
        <RecordModal<Schemas['WorkOrder']>
          title={editing.record ? 'Edit work order' : 'New work order'}
          endpoint="/api/v1/work-orders/"
          fields={workOrderFields({ withApparatus: false })}
          record={editing.record}
          defaults={{ priority: 'normal', status: 'open' }}
          prepare={(body) => ({ ...body, apparatus: id })}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      ) : null}
      {editing?.kind === 'schedule' ? (
        <RecordModal<Schemas['MaintenanceSchedule']>
          title={editing.record ? 'Edit maintenance task' : 'New maintenance task'}
          endpoint="/api/v1/maintenance-schedules/"
          fields={maintenanceFields}
          record={editing.record}
          prepare={(body) => ({ ...body, apparatus: id })}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      ) : null}
      {editing?.kind === 'service' ? (
        <RecordModal<Schemas['ServiceRecord']>
          title={
            editing.record ? 'Edit service record' : editing.schedule ? `Log: ${editing.schedule.task}` : 'Log service'
          }
          endpoint="/api/v1/service-records/"
          fields={serviceRecordFields}
          record={editing.record}
          defaults={{
            performed_on: isoDate(),
            description: editing.schedule?.task ?? '',
            mileage: String(rig.data?.mileage ?? ''),
            engine_hours: String(rig.data?.engine_hours ?? ''),
          }}
          prepare={(body, record) => ({
            ...body,
            apparatus: id,
            schedule: record ? record.schedule : (editing.schedule?.id ?? null),
          })}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      ) : null}
      {inspection ? <InspectionModal inspection={inspection} onClose={() => setInspection(null)} /> : null}
    </div>
  );
}

function WorkOrdersTab({ id, onEdit }: { id: number; onEdit: (record: Schemas['WorkOrder'] | null) => void }) {
  const [showClosed, setShowClosed] = useState(false);
  const orders = useQuery({
    queryKey: ['/api/v1/work-orders/', { apparatus: id, showClosed }],
    queryFn: () =>
      getAll<Schemas['WorkOrder']>('/api/v1/work-orders/', { apparatus: id, open: showClosed ? undefined : true }),
  });
  return (
    <div className="stack-sm">
      <div className="row spread">
        <label className="checkbox">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Include completed and cancelled
        </label>
        <Button variant="primary" onClick={() => onEdit(null)}>
          New work order
        </Button>
      </div>
      <QueryState query={orders}>
        {(rows) => <DataTable rows={rows} onRowClick={onEdit} empty="No work orders." columns={workOrderColumns} />}
      </QueryState>
    </div>
  );
}

export const workOrderColumns = [
  { header: 'Reported', cell: (w: Schemas['WorkOrder']) => formatDay(w.created_at.slice(0, 10)) },
  {
    header: 'Problem',
    cell: (w: Schemas['WorkOrder']) => (
      <div>
        <div style={{ fontWeight: 600 }}>{w.title}</div>
        {w.description ? <div className="muted small">{w.description}</div> : null}
      </div>
    ),
  },
  {
    header: 'Priority',
    cell: (w: Schemas['WorkOrder']) => (
      <Badge tone={priorityTone[w.priority ?? 'normal']}>{labelFor(priorities, w.priority)}</Badge>
    ),
  },
  {
    header: 'Status',
    cell: (w: Schemas['WorkOrder']) => {
      const s = workOrderStatus[w.status ?? 'open'];
      return (
        <span className="row">
          <Badge tone={s.tone}>{s.label}</Badge>
          {w.takes_out_of_service && w.status !== 'completed' && w.status !== 'cancelled' ? (
            <Badge tone="danger">OOS</Badge>
          ) : null}
        </span>
      );
    },
  },
  { header: 'Assigned to', cell: (w: Schemas['WorkOrder']) => w.assigned_to },
  { header: 'Cost', cell: (w: Schemas['WorkOrder']) => (w.cost ? `$${w.cost}` : ''), className: 'num' },
];

function ChecksTab({ id, onOpen }: { id: number; onOpen: (inspection: Schemas['Inspection']) => void }) {
  const inspections = useQuery({
    queryKey: ['/api/v1/inspections/', { apparatus: id }],
    queryFn: () =>
      http.get<{ results: Schemas['Inspection'][] }>('/api/v1/inspections/', { apparatus: id, page_size: 50 }),
  });
  return (
    <QueryState query={inspections}>
      {(page) => (
        <DataTable
          rows={page.results}
          onRowClick={onOpen}
          empty="No rig checks logged yet. Crews log them from the mobile app."
          columns={[
            { header: 'When', cell: (i) => formatDateTime(i.performed_at ?? '') },
            {
              header: 'Result',
              cell: (i) =>
                i.deficiency_count ? (
                  <Badge tone="warning">{i.deficiency_count} deficient</Badge>
                ) : (
                  <Badge tone="success">All OK</Badge>
                ),
            },
            { header: 'Mileage', cell: (i) => i.mileage?.toLocaleString() ?? '', className: 'num' },
            { header: 'Notes', cell: (i) => i.notes },
          ]}
        />
      )}
    </QueryState>
  );
}

function InspectionModal({ inspection, onClose }: { inspection: Schemas['Inspection']; onClose: () => void }) {
  const people = useQuery({
    queryKey: ['/api/v1/users/', inspection.performed_by],
    queryFn: () => http.get<Schemas['User']>(`/api/v1/users/${inspection.performed_by}/`),
  });
  return (
    <Modal title={`Rig check · ${formatDateTime(inspection.performed_at ?? '')}`} open onClose={onClose}>
      <div className="stack-sm">
        <p className="muted">By {people.data?.full_name || people.data?.username || '…'}</p>
        {inspection.notes ? <p>{inspection.notes}</p> : null}
        <DataTable
          rows={inspection.results.map((r, i) => ({ ...r, id: i }))}
          columns={[
            { header: 'Item', cell: (r) => r.prompt },
            {
              header: 'Result',
              cell: (r) =>
                r.status === 'deficient' ? (
                  <Badge tone="danger">Problem</Badge>
                ) : r.status === 'na' ? (
                  <Badge>N/A</Badge>
                ) : (
                  <Badge tone="success">OK</Badge>
                ),
            },
            { header: 'Note', cell: (r) => r.note },
          ]}
        />
      </div>
    </Modal>
  );
}

function MaintenanceTab({
  id,
  onEdit,
  onLog,
}: {
  id: number;
  onEdit: (record: Schemas['MaintenanceSchedule'] | null) => void;
  onLog: (schedule: Schemas['MaintenanceSchedule']) => void;
}) {
  const schedules = useQuery({
    queryKey: ['/api/v1/maintenance-schedules/', { apparatus: id }],
    queryFn: () => getAll<Schemas['MaintenanceSchedule']>('/api/v1/maintenance-schedules/', { apparatus: id }),
  });
  return (
    <div className="stack-sm">
      <div className="row spread">
        <p className="muted small">Due by date, mileage or engine hours, whichever comes first.</p>
        <Button variant="primary" onClick={() => onEdit(null)}>
          Add maintenance task
        </Button>
      </div>
      <QueryState query={schedules}>
        {(rows) =>
          rows.length === 0 ? (
            <Empty>No preventive maintenance set up. Add pump tests, ladder tests, oil changes…</Empty>
          ) : (
            <DataTable
              rows={rows}
              columns={[
                { header: 'Task', cell: (s) => <strong>{s.task}</strong> },
                {
                  header: 'Interval',
                  cell: (s) =>
                    [
                      s.interval_days && `${s.interval_days} days`,
                      s.interval_miles && `${s.interval_miles.toLocaleString()} mi`,
                      s.interval_hours && `${s.interval_hours} hrs`,
                    ]
                      .filter(Boolean)
                      .join(' / '),
                },
                { header: 'Last done', cell: (s) => (s.last_performed_on ? formatDay(s.last_performed_on) : 'Never') },
                {
                  header: 'Next due',
                  cell: (s) =>
                    [
                      s.next_due_date && formatDay(s.next_due_date),
                      s.next_due_mileage && `${s.next_due_mileage.toLocaleString()} mi`,
                      s.next_due_engine_hours && `${s.next_due_engine_hours} hrs`,
                    ]
                      .filter(Boolean)
                      .join(' / ') || '—',
                },
                {
                  header: 'Status',
                  cell: (s) => (s.is_due ? <Badge tone="warning">Due</Badge> : <Badge tone="success">OK</Badge>),
                },
                {
                  header: '',
                  cell: (s) => (
                    <span className="row">
                      <Button small variant="primary" onClick={() => onLog(s)}>
                        Log done
                      </Button>
                      <Button small onClick={() => onEdit(s)}>
                        Edit
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          )
        }
      </QueryState>
    </div>
  );
}

function ServiceTab({ id, onEdit }: { id: number; onEdit: (record: Schemas['ServiceRecord'] | null) => void }) {
  const records = useQuery({
    queryKey: ['/api/v1/service-records/', { apparatus: id }],
    queryFn: () => getAll<Schemas['ServiceRecord']>('/api/v1/service-records/', { apparatus: id }),
  });
  return (
    <div className="stack-sm">
      <div className="row spread">
        <span />
        <Button variant="primary" onClick={() => onEdit(null)}>
          Log service
        </Button>
      </div>
      <QueryState query={records}>
        {(rows) => (
          <DataTable
            rows={rows}
            onRowClick={onEdit}
            empty="No service logged yet."
            columns={[
              { header: 'Date', cell: (r) => formatDay(r.performed_on ?? '') },
              { header: 'Work', cell: (r) => r.description },
              { header: 'By', cell: (r) => r.performed_by },
              { header: 'Mileage', cell: (r) => r.mileage?.toLocaleString() ?? '', className: 'num' },
              {
                header: 'Result',
                cell: (r) =>
                  r.passed === true ? (
                    <Badge tone="success">Passed</Badge>
                  ) : r.passed === false ? (
                    <Badge tone="danger">Failed</Badge>
                  ) : null,
              },
              { header: 'Cost', cell: (r) => (r.cost ? `$${r.cost}` : ''), className: 'num' },
            ]}
          />
        )}
      </QueryState>
    </div>
  );
}

function AwayBanner({ rig, onReturned }: { rig: Schemas['Apparatus']; onReturned: () => void }) {
  const move = rig.current_move!;
  const returnHome = useMutation({
    mutationFn: () => http.post<Schemas['Apparatus']>(`/api/v1/apparatus/${rig.id}/return/`),
    onSuccess: onReturned,
  });
  return (
    <div className="alert row spread" role="status">
      <span>
        <strong>
          At {move.station_name} {move.ends_on ? `through ${formatDay(move.ends_on)}` : 'until returned'}
        </strong>
        {move.covering_for_unit ? ` · covering for ${move.covering_for_unit}` : ''}
        {move.reason ? ` · ${move.reason}` : ''}
        <span className="muted"> · home station {rig.station_name ?? 'none'}</span>
      </span>
      <Button small loading={returnHome.isPending} onClick={() => returnHome.mutate()}>
        Return home
      </Button>
      {returnHome.error ? <ErrorBox error={returnHome.error} /> : null}
    </div>
  );
}

function moveFields(temporary: boolean): FieldSpec[] {
  const fields: FieldSpec[] = [
    {
      name: 'station',
      label: 'To',
      type: 'relation',
      required: true,
      endpoint: '/api/v1/stations/',
      optionLabel: stationLabel as (row: never) => string,
    },
    {
      name: 'length',
      label: 'For how long',
      type: 'select',
      required: true,
      options: [
        { value: 'temporary', label: 'Temporarily (returns on its own)' },
        { value: 'permanent', label: 'Permanently (changes its home station)' },
      ],
    },
  ];
  if (temporary) {
    fields.push(
      { name: 'until', label: 'Last day away', type: 'date', help: 'Leave blank to keep it there until returned' },
      {
        name: 'covering_for',
        label: 'Covering for',
        type: 'relation',
        endpoint: '/api/v1/apparatus/',
        optionLabel: ((a: Schemas['Apparatus']) => a.unit_number) as (row: never) => string,
        help: 'A rig out of service whose crew rides this one meanwhile',
      },
    );
  }
  fields.push({
    name: 'crew_moves',
    label: 'Crew moves with the rig',
    type: 'checkbox',
    help: temporary
      ? 'Otherwise members assigned to ride it stay at their station without it'
      : 'Otherwise members assigned to ride it stay at their station and are taken off it',
  });
  if (temporary) fields.push({ name: 'reason', label: 'Reason', type: 'text', placeholder: 'e.g. E1 in the shop' });
  return fields;
}

function MoveModal({ rig, onClose, onMoved }: { rig: Schemas['Apparatus']; onClose: () => void; onMoved: () => void }) {
  const [values, setValues] = useState<Values>({ length: 'temporary', crew_moves: false });
  const temporary = values.length !== 'permanent';
  const move = useMutation({
    mutationFn: () =>
      http.post<Schemas['Apparatus']>(`/api/v1/apparatus/${rig.id}/move/`, {
        station: Number(values.station),
        temporary,
        until: temporary && values.until ? values.until : null,
        covering_for: temporary && values.covering_for ? Number(values.covering_for) : null,
        crew_moves: Boolean(values.crew_moves),
        reason: temporary ? (values.reason ?? '') : '',
      }),
    onSuccess: onMoved,
  });
  return (
    <Modal
      title={`Move ${rig.unit_number}`}
      open
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="move-rig" loading={move.isPending}>
            Move
          </Button>
        </>
      }>
      <Form
        id="move-rig"
        fields={moveFields(temporary)}
        values={values}
        onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
        onSubmit={() => move.mutate()}
        error={move.error}
      />
    </Modal>
  );
}
