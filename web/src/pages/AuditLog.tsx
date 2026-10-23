import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { http, type Page, type Schemas } from '@/api/http';
import { Badge, Button, DataTable, Modal, PageHeader, QueryState } from '@/components/ui';
import { formatDateTime, humanize } from '@/lib/format';

const models: { value: string; label: string }[] = [
  { value: 'apparatus.Apparatus', label: 'Apparatus' },
  { value: 'apparatus.WorkOrder', label: 'Work orders' },
  { value: 'apparatus.Inspection', label: 'Rig checks' },
  { value: 'apparatus.ChecklistTemplate', label: 'Checklists' },
  { value: 'apparatus.MaintenanceSchedule', label: 'Maintenance schedules' },
  { value: 'apparatus.ServiceRecord', label: 'Service records' },
  { value: 'inventory.Item', label: 'Inventory items' },
  { value: 'inventory.StockLevel', label: 'Stock levels' },
  { value: 'inventory.StorageLocation', label: 'Storage locations' },
  { value: 'scheduling.LeaveRequest', label: 'Leave' },
  { value: 'scheduling.ShiftTrade', label: 'Shift trades' },
  { value: 'scheduling.Assignment', label: 'Assignments' },
  { value: 'scheduling.Platoon', label: 'Platoons' },
  { value: 'scheduling.RotationPattern', label: 'Rotation patterns' },
  { value: 'events.Event', label: 'Events' },
  { value: 'core.User', label: 'People' },
  { value: 'core.Station', label: 'Stations' },
];

const actionTone = { create: 'success', update: 'neutral', delete: 'danger' } as const;

export default function AuditLog() {
  const [model, setModel] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Schemas['AuditEntry'] | null>(null);

  const log = useQuery({
    queryKey: ['/api/v1/audit-log/', model, action, search, page],
    queryFn: () =>
      http.get<Page<Schemas['AuditEntry']>>('/api/v1/audit-log/', {
        model: model || undefined,
        action: action || undefined,
        search: search || undefined,
        page,
        page_size: 50,
      }),
    placeholderData: (previous) => previous,
  });

  const reset = () => setPage(1);
  return (
    <div>
      <PageHeader title="Audit log" subtitle="Every change to your department's records: who, what and when." />
      <div className="toolbar">
        <input
          type="search"
          aria-label="Search records"
          placeholder="Search record names…"
          value={search}
          onChange={(e) => (setSearch(e.target.value), reset())}
        />
        <select aria-label="Record type" value={model} onChange={(e) => (setModel(e.target.value), reset())}>
          <option value="">All records</option>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select aria-label="Action" value={action} onChange={(e) => (setAction(e.target.value), reset())}>
          <option value="">All actions</option>
          <option value="create">Created</option>
          <option value="update">Updated</option>
          <option value="delete">Deleted</option>
        </select>
      </div>
      <QueryState query={log}>
        {(data) => (
          <div className="stack-sm">
            <DataTable
              rows={data.results}
              onRowClick={setOpen}
              empty="No changes recorded."
              columns={[
                { header: 'When', cell: (e) => formatDateTime(e.created_at) },
                { header: 'Who', cell: (e) => e.actor_name },
                { header: 'Action', cell: (e) => <Badge tone={actionTone[e.action]}>{e.action}</Badge> },
                { header: 'Record', cell: (e) => models.find((m) => m.value === e.model)?.label ?? e.model },
                { header: 'Name', cell: (e) => <strong>{e.object_repr}</strong> },
                {
                  header: 'Changed',
                  cell: (e) =>
                    e.action === 'update'
                      ? Object.keys(e.changes as object)
                          .map(humanize)
                          .join(', ')
                      : '',
                },
              ]}
            />
            <div className="row spread">
              <span className="muted small">{data.count.toLocaleString()} changes</span>
              <div className="row">
                <Button small disabled={!data.previous} onClick={() => setPage((p) => p - 1)}>
                  Newer
                </Button>
                <Button small disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
                  Older
                </Button>
              </div>
            </div>
          </div>
        )}
      </QueryState>
      {open ? (
        <Modal title={`${humanize(open.action)}: ${open.object_repr}`} open onClose={() => setOpen(null)}>
          <div className="stack-sm">
            <p className="muted">
              {open.actor_name} · {formatDateTime(open.created_at)}
            </p>
            <Changes entry={open} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function show(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function Changes({ entry }: { entry: Schemas['AuditEntry'] }) {
  const changes = entry.changes as Record<string, unknown>;
  const rows = Object.entries(changes).map(([field, value], id) => ({ id, field, value }));
  return (
    <DataTable
      rows={rows}
      columns={[
        { header: 'Field', cell: (r) => humanize(r.field) },
        {
          header: entry.action === 'update' ? 'Before → after' : 'Value',
          cell: (r) =>
            entry.action === 'update' && Array.isArray(r.value) ? (
              <span className="diff">
                <del>{show(r.value[0])}</del> → <ins>{show(r.value[1])}</ins>
              </span>
            ) : (
              <span className="diff">{show(r.value)}</span>
            ),
        },
      ]}
    />
  );
}
