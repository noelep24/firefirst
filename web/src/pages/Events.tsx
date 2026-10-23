import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { RecordModal } from '@/components/crud';
import type { FieldSpec } from '@/components/form';
import { Badge, Button, DataTable, ErrorBox, Modal, PageHeader, QueryState, Tabs } from '@/components/ui';
import { personLabel, stationLabel } from '@/lib/fields';
import { addDays, formatDateTime, formatTime, isoDate } from '@/lib/format';
import { eventCategories, labelFor } from '@/lib/labels';

const eventFields: FieldSpec[] = [
  { name: 'title', label: 'Title', type: 'text', required: true, wide: true },
  { name: 'category', label: 'Type', type: 'select', options: eventCategories, required: true },
  {
    name: 'station',
    label: 'Station',
    type: 'relation',
    endpoint: '/api/v1/stations/',
    optionLabel: stationLabel as (row: never) => string,
    help: 'Blank for department-wide',
  },
  { name: 'starts_at', label: 'Starts', type: 'datetime', required: true },
  { name: 'ends_at', label: 'Ends', type: 'datetime', required: true },
  { name: 'location', label: 'Location', type: 'text' },
  {
    name: 'training_hours',
    label: 'Training credit (hours)',
    type: 'number',
    step: '0.25',
    min: 0,
    help: 'Awarded to members marked as attended',
  },
  { name: 'description', label: 'Details', type: 'textarea' },
  { name: 'all_day', label: 'All day', type: 'checkbox' },
  { name: 'is_mandatory', label: 'Mandatory (invites every active member)', type: 'checkbox' },
  {
    name: 'invitees',
    label: 'Invite members',
    type: 'relation',
    multiple: true,
    endpoint: '/api/v1/users/',
    query: { is_active: true },
    optionLabel: personLabel as (row: never) => string,
    help: 'Ctrl/⌘-click to pick several. Adds invitations; it never removes them.',
  },
];

type Tab = 'upcoming' | 'past' | 'training';

export default function Events() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('open');
  const [tab, setTab] = useState<Tab>('upcoming');
  const [editing, setEditing] = useState<Schemas['Event'] | null | 'new'>(null);
  const queryClient = useQueryClient();

  return (
    <div>
      <PageHeader
        title="Events & training"
        subtitle="Training, drills, meetings and community events."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New event
          </Button>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'past', label: 'Past 90 days' },
          { value: 'training', label: 'Training hours' },
        ]}
      />
      {tab === 'training' ? (
        <TrainingHours />
      ) : (
        <EventList past={tab === 'past'} onOpen={(e) => setParams({ open: String(e.id) })} />
      )}

      {openId ? (
        <EventModal
          id={Number(openId)}
          onClose={() => setParams({})}
          onEdit={(event) => {
            setParams({});
            setEditing(event);
          }}
        />
      ) : null}
      {editing ? (
        <RecordModal<Schemas['Event']>
          title={editing === 'new' ? 'New event' : 'Edit event'}
          endpoint="/api/v1/events/"
          fields={eventFields}
          record={editing === 'new' ? null : editing}
          defaults={{ category: 'training' }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries();
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function EventList({ past, onOpen }: { past: boolean; onOpen: (event: Schemas['Event']) => void }) {
  const today = isoDate();
  const [start, end] = past ? [addDays(today, -90), addDays(today, -1)] : [today, addDays(today, 365)];
  const events = useQuery({
    queryKey: ['/api/v1/events/', start, end],
    queryFn: () => getAll<Schemas['Event']>('/api/v1/events/', { start, end }),
  });
  return (
    <QueryState query={events}>
      {(rows) => (
        <DataTable
          rows={past ? [...rows].reverse() : rows}
          onRowClick={onOpen}
          empty={past ? 'No events in the last 90 days.' : 'Nothing scheduled.'}
          columns={[
            {
              header: 'When',
              cell: (e) =>
                e.all_day
                  ? `${formatDateTime(e.starts_at).split(',').slice(0, 2).join(',')} · all day`
                  : `${formatDateTime(e.starts_at)} – ${formatTime(e.ends_at)}`,
            },
            { header: 'Event', cell: (e) => <strong>{e.title}</strong> },
            { header: 'Type', cell: (e) => labelFor(eventCategories, e.category) },
            { header: 'Location', cell: (e) => e.location },
            {
              header: 'Going',
              className: 'num',
              cell: (e) => e.attendance.filter((a) => a.status === 'going' || a.status === 'attended').length || '',
            },
            { header: '', cell: (e) => (e.is_mandatory ? <Badge tone="danger">Mandatory</Badge> : null) },
          ]}
        />
      )}
    </QueryState>
  );
}

const statusTone: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  invited: 'neutral',
  going: 'success',
  declined: 'warning',
  attended: 'success',
  absent: 'danger',
};

function EventModal({
  id,
  onClose,
  onEdit,
}: {
  id: number;
  onClose: () => void;
  onEdit: (event: Schemas['Event']) => void;
}) {
  const queryClient = useQueryClient();
  const event = useQuery({
    queryKey: ['/api/v1/events/', id],
    queryFn: () => http.get<Schemas['Event']>(`/api/v1/events/${id}/`),
  });
  const people = useQuery({
    queryKey: ['/api/v1/users/', 'active'],
    queryFn: () => getAll<Schemas['User']>('/api/v1/users/', { is_active: true }),
  });
  const [marks, setMarks] = useState<Record<number, 'attended' | 'absent' | undefined>>({});

  const save = useMutation({
    mutationFn: () => {
      const attended = Object.entries(marks)
        .filter(([, v]) => v === 'attended')
        .map(([k]) => Number(k));
      const absent = Object.entries(marks)
        .filter(([, v]) => v === 'absent')
        .map(([k]) => Number(k));
      return http.post<Schemas['Event']>(`/api/v1/events/${id}/attendance/`, { attended, absent });
    },
    onSuccess: () => {
      setMarks({});
      queryClient.invalidateQueries();
    },
  });

  return (
    <Modal
      title={event.data?.title ?? 'Event'}
      open
      onClose={onClose}
      footer={
        event.data ? (
          <>
            <Button onClick={() => onEdit(event.data!)}>Edit event</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={Object.keys(marks).length === 0}>
              Save attendance
            </Button>
          </>
        ) : undefined
      }>
      <QueryState query={event}>
        {(e) => {
          const byUser = new Map(e.attendance.map((a) => [a.user, a.status]));
          // Invited members first, then everyone else (walk-ins can be marked too).
          const roster = [...(people.data ?? [])].sort((a, b) => Number(byUser.has(b.id)) - Number(byUser.has(a.id)));
          return (
            <div className="stack">
              <div className="stack-sm">
                <div className="row">
                  <Badge>{labelFor(eventCategories, e.category)}</Badge>
                  {e.is_mandatory ? <Badge tone="danger">Mandatory</Badge> : null}
                  {e.training_hours ? <Badge tone="success">{Number(e.training_hours)} training hrs</Badge> : null}
                </div>
                <p>
                  {formatDateTime(e.starts_at)} – {formatTime(e.ends_at)}
                  {e.location ? ` · ${e.location}` : ''}
                </p>
                {e.description ? <p className="muted">{e.description}</p> : null}
              </div>
              <div className="stack-sm">
                <h3>Attendance</h3>
                <p className="muted small">
                  Mark who attended after the event. Attended members get the training credit.
                </p>
                <ErrorBox error={save.error} />
                <DataTable
                  rows={roster}
                  empty="No members."
                  columns={[
                    { header: 'Member', cell: (u) => personLabel(u) },
                    {
                      header: 'Status',
                      cell: (u) => {
                        const s = byUser.get(u.id);
                        return s ? (
                          <Badge tone={statusTone[s]}>{s}</Badge>
                        ) : (
                          <span className="muted small">Not invited</span>
                        );
                      },
                    },
                    {
                      header: 'Mark',
                      cell: (u) => (
                        <select
                          aria-label={`Attendance for ${personLabel(u)}`}
                          value={marks[u.id] ?? ''}
                          onChange={(ev) =>
                            setMarks((prev) => ({
                              ...prev,
                              [u.id]: (ev.target.value || undefined) as 'attended' | 'absent' | undefined,
                            }))
                          }>
                          <option value="">—</option>
                          <option value="attended">Attended</option>
                          <option value="absent">Absent</option>
                        </select>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          );
        }}
      </QueryState>
    </Modal>
  );
}

function TrainingHours() {
  const today = isoDate();
  const [start, setStart] = useState(`${today.slice(0, 4)}-01-01`);
  const [end, setEnd] = useState(today);
  const hours = useQuery({
    queryKey: ['/api/v1/events/training-hours/', start, end],
    queryFn: () => http.get<Schemas['TrainingHours'][]>('/api/v1/events/training-hours/', { start, end }),
  });
  return (
    <div>
      <div className="toolbar">
        <label className="field-label" htmlFor="th-start">
          From
        </label>
        <input id="th-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        <label className="field-label" htmlFor="th-end">
          to
        </label>
        <input id="th-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <QueryState query={hours}>
        {(rows) => (
          <DataTable
            rows={rows.map((r) => ({ ...r, id: r.user }))}
            empty="No training credit recorded in this period."
            columns={[
              { header: 'Member', cell: (r) => r.name },
              { header: 'Hours', cell: (r) => Number(r.hours).toLocaleString(), className: 'num' },
            ]}
          />
        )}
      </QueryState>
    </div>
  );
}
