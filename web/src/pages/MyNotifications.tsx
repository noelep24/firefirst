import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { http, type Schemas } from '@/api/http';
import { Button, ErrorBox, PageHeader, QueryState } from '@/components/ui';

type Row = Schemas['MyChannel'];

/** Which notifications you get on your phone and by email. Everything always shows in the bell. */
export default function MyNotifications() {
  const mine = useQuery({
    queryKey: ['/api/v1/me/notifications/'],
    queryFn: () => http.get<Row[]>('/api/v1/me/notifications/'),
  });
  return (
    <div className="stack">
      <PageHeader
        title="My notifications"
        subtitle="Choose what reaches your phone and email. Everything still shows in the bell."
      />
      <QueryState query={mine}>{(rows) => <Choices rows={rows} />}</QueryState>
    </div>
  );
}

function Choices({ rows }: { rows: Row[] }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(rows);
  const [saved, setSaved] = useState(false);
  const set = (kind: string, change: Partial<Row>) => {
    setSaved(false);
    setValues(values.map((r) => (r.kind === kind ? { ...r, ...change } : r)));
  };
  const save = useMutation({
    mutationFn: () =>
      http.patch<Row[]>(
        '/api/v1/me/notifications/',
        values.map(({ kind, push, email }) => ({ kind, push, email })),
      ),
    onSuccess: (data) => {
      setSaved(true);
      queryClient.setQueryData(['/api/v1/me/notifications/'], data);
    },
  });

  const cell = (r: Row, channel: 'push' | 'email') => {
    const sent = channel === 'push' ? r.department_push : r.department_email;
    if (!sent) return <span className="muted small">Not sent</span>;
    return (
      <input
        type="checkbox"
        aria-label={`${r.label} by ${channel === 'push' ? 'phone' : 'email'}`}
        checked={r[channel]}
        disabled={r.required}
        title={r.required ? 'Required by your department' : undefined}
        onChange={(e) => set(r.kind, { [channel]: e.target.checked })}
      />
    );
  };

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Notification</th>
              <th className="center">Phone</th>
              <th className="center">Email</th>
            </tr>
          </thead>
          <tbody>
            {values.map((r) => (
              <tr key={r.kind}>
                <td>
                  {r.label}
                  {r.required ? <span className="muted small"> · required</span> : null}
                </td>
                <td className="center">{cell(r, 'push')}</td>
                <td className="center">{cell(r, 'email')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="field-help">
        "Not sent" means your department doesn't send that one by phone or email. Email goes to the address on your
        profile.
      </p>
      <ErrorBox error={save.error} />
      {saved ? <div className="notice">Saved.</div> : null}
      <div>
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </div>
  );
}
