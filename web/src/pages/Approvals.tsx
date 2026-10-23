import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getAll, http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { Badge, Button, DataTable, ErrorBox, PageHeader, QueryState, Tabs } from '@/components/ui';
import { formatDay } from '@/lib/format';
import { leaveTypeLabel, requestStatus } from '@/lib/labels';

type Tab = 'pending' | 'leave' | 'trades';

export default function Approvals() {
  const [tab, setTab] = useState<Tab>('pending');
  return (
    <div>
      <PageHeader title="Approvals" subtitle="Leave requests and shift trades from your members." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pending', label: 'Waiting on you' },
          { value: 'leave', label: 'All leave' },
          { value: 'trades', label: 'All trades' },
        ]}
      />
      {tab === 'pending' ? <Pending /> : null}
      {tab === 'leave' ? <LeaveHistory /> : null}
      {tab === 'trades' ? <TradeHistory /> : null}
    </div>
  );
}

function range(l: Schemas['LeaveRequest']) {
  return l.start_date === l.end_date
    ? formatDay(l.start_date)
    : `${formatDay(l.start_date)} – ${formatDay(l.end_date)}`;
}

function StatusBadge({ status }: { status: string | undefined }) {
  const s = requestStatus[status ?? 'pending'];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

function Pending() {
  const { me } = useMe();
  const queryClient = useQueryClient();
  const leave = useQuery({
    queryKey: ['/api/v1/leave-requests/', 'pending'],
    queryFn: () => getAll<Schemas['LeaveRequest']>('/api/v1/leave-requests/', { status: 'pending' }),
  });
  // Approved leave overlapping the pending requests, to show who else is already off.
  const approved = useQuery({
    queryKey: ['/api/v1/leave-requests/', 'approved-overlap', leave.data?.map((l) => l.id)],
    enabled: Boolean(leave.data?.length),
    queryFn: () => {
      const start = leave.data!.map((l) => l.start_date).sort()[0];
      const end = leave
        .data!.map((l) => l.end_date)
        .sort()
        .at(-1)!;
      return getAll<Schemas['LeaveRequest']>('/api/v1/leave-requests/', { status: 'approved', start, end });
    },
  });
  const trades = useQuery({
    queryKey: ['/api/v1/shift-trades/', 'pending_approval'],
    queryFn: () => getAll<Schemas['ShiftTrade']>('/api/v1/shift-trades/', { status: 'pending_approval' }),
  });

  const [notes, setNotes] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: ({
      kind,
      id,
      action,
    }: {
      kind: 'leave-requests' | 'shift-trades';
      id: number;
      action: 'approve' | 'deny';
    }) =>
      http.post(`/api/v1/${kind}/${id}/${action}/`, kind === 'leave-requests' ? { note: notes[`l${id}`] ?? '' } : {}),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const othersOff = (l: Schemas['LeaveRequest']) =>
    (approved.data ?? []).filter((a) => a.user !== l.user && a.start_date <= l.end_date && a.end_date >= l.start_date)
      .length;

  return (
    <div className="stack">
      <ErrorBox error={act.error} />
      <section className="stack-sm">
        <h2>Leave requests</h2>
        <QueryState query={leave}>
          {(rows) => (
            <DataTable
              rows={rows}
              empty="No leave waiting for approval."
              columns={[
                { header: 'Member', cell: (l) => <strong>{l.user_name}</strong> },
                { header: 'Type', cell: (l) => leaveTypeLabel(l.leave_type) },
                { header: 'Dates', cell: (l) => range(l) },
                { header: 'Reason', cell: (l) => l.reason },
                {
                  header: 'Others off',
                  cell: (l) => {
                    const n = othersOff(l);
                    return n ? <Badge tone="warning">{n} already approved</Badge> : <span className="muted">None</span>;
                  },
                },
                {
                  header: 'Note',
                  cell: (l) => (
                    <input
                      aria-label={`Note for ${l.user_name}`}
                      placeholder="Optional note"
                      value={notes[`l${l.id}`] ?? ''}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [`l${l.id}`]: e.target.value }))}
                    />
                  ),
                },
                {
                  header: '',
                  cell: (l) =>
                    l.user === me.id ? (
                      <span className="muted small">Your own request: another officer must approve</span>
                    ) : (
                      <span className="row">
                        <Button
                          small
                          variant="primary"
                          onClick={() => act.mutate({ kind: 'leave-requests', id: l.id, action: 'approve' })}>
                          Approve
                        </Button>
                        <Button small onClick={() => act.mutate({ kind: 'leave-requests', id: l.id, action: 'deny' })}>
                          Deny
                        </Button>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </QueryState>
      </section>
      <section className="stack-sm">
        <h2>Shift trades</h2>
        <p className="muted small">Both members have agreed; these need an officer&apos;s approval.</p>
        <QueryState query={trades}>
          {(rows) => (
            <DataTable
              rows={rows}
              empty="No trades waiting for approval."
              columns={[
                { header: 'Shift', cell: (t) => formatDay(t.shift_date, { weekday: 'long' }) },
                { header: 'Working', cell: (t) => <strong>{t.covering_member_name}</strong> },
                { header: 'Instead of', cell: (t) => t.requester_name },
                { header: 'Note', cell: (t) => t.note },
                {
                  header: '',
                  cell: (t) =>
                    t.requester === me.id || t.covering_member === me.id ? (
                      <span className="muted small">You're part of this trade</span>
                    ) : (
                      <span className="row">
                        <Button
                          small
                          variant="primary"
                          onClick={() => act.mutate({ kind: 'shift-trades', id: t.id, action: 'approve' })}>
                          Approve
                        </Button>
                        <Button small onClick={() => act.mutate({ kind: 'shift-trades', id: t.id, action: 'deny' })}>
                          Deny
                        </Button>
                      </span>
                    ),
                },
              ]}
            />
          )}
        </QueryState>
      </section>
    </div>
  );
}

function LeaveHistory() {
  const [status, setStatus] = useState('');
  const leave = useQuery({
    queryKey: ['/api/v1/leave-requests/', 'all', status],
    queryFn: () => getAll<Schemas['LeaveRequest']>('/api/v1/leave-requests/', { status: status || undefined }),
  });
  return (
    <div>
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['pending', 'approved', 'denied', 'cancelled'].map((s) => (
            <option key={s} value={s}>
              {requestStatus[s].label}
            </option>
          ))}
        </select>
      </div>
      <QueryState query={leave}>
        {(rows) => (
          <DataTable
            rows={rows}
            empty="No leave requests."
            columns={[
              { header: 'Member', cell: (l) => l.user_name },
              { header: 'Type', cell: (l) => leaveTypeLabel(l.leave_type) },
              { header: 'Dates', cell: (l) => range(l) },
              { header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
              { header: 'Reason', cell: (l) => l.reason },
              { header: 'Review note', cell: (l) => l.review_note },
            ]}
          />
        )}
      </QueryState>
    </div>
  );
}

function TradeHistory() {
  const trades = useQuery({
    queryKey: ['/api/v1/shift-trades/', 'all'],
    queryFn: () => getAll<Schemas['ShiftTrade']>('/api/v1/shift-trades/'),
  });
  return (
    <QueryState query={trades}>
      {(rows) => (
        <DataTable
          rows={rows}
          empty="No shift trades."
          columns={[
            { header: 'Shift', cell: (t) => formatDay(t.shift_date, { year: 'numeric' }) },
            { header: 'Working', cell: (t) => t.covering_member_name },
            { header: 'Instead of', cell: (t) => t.requester_name },
            { header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
            { header: 'Note', cell: (t) => t.note },
          ]}
        />
      )}
    </QueryState>
  );
}
