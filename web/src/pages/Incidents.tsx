import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { Badge, Button, DataTable, PageHeader, QueryState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { shortLabel } from '@/lib/neris';

export default function Incidents() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const incidents = useQuery({
    queryKey: ['/api/v1/incidents/', status],
    queryFn: () =>
      getAll<Schemas['Incident']>('/api/v1/incidents/', { ordering: '-alarm_at', ...(status ? { status } : {}) }),
  });
  const create = useMutation({
    mutationFn: () => http.post<Schemas['Incident']>('/api/v1/incidents/', { alarm_at: new Date().toISOString() }),
    onSuccess: (incident) => navigate(`/incidents/${incident.id}`),
  });

  return (
    <div className="stack">
      <PageHeader
        title="Incidents"
        subtitle="Incident reports in NERIS format. Units and crews fill in from the roster."
        actions={
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            New incident
          </Button>
        }
      />
      <div className="toolbar">
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All reports</option>
          <option value="draft">Drafts</option>
          <option value="complete">Complete</option>
        </select>
      </div>
      <QueryState query={incidents}>
        {(rows) => (
          <DataTable
            rows={rows}
            empty="No incidents yet. Start one with New incident."
            onRowClick={(i) => navigate(`/incidents/${i.id}`)}
            columns={[
              { header: 'Number', cell: (i) => <strong>{i.number}</strong> },
              { header: 'Alarm', cell: (i) => formatDateTime(i.alarm_at) },
              {
                header: 'Type',
                cell: (i) => (i.type_labels.length ? shortLabel(i.type_labels[0]) : <span className="muted">—</span>),
              },
              { header: 'Address', cell: (i) => [i.address, i.city].filter(Boolean).join(', ') || '—' },
              { header: 'Units', cell: (i) => i.units.map((u) => u.unit).join(', ') || '—' },
              {
                header: 'Status',
                cell: (i) =>
                  i.status === 'complete' ? (
                    <Badge tone="success">Complete</Badge>
                  ) : i.missing.length ? (
                    <Badge tone="warning">{`${i.missing.length} to go`}</Badge>
                  ) : (
                    <Badge tone="neutral">Ready</Badge>
                  ),
              },
            ]}
          />
        )}
      </QueryState>
    </div>
  );
}
