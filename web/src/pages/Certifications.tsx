import { useQuery } from '@tanstack/react-query';

import { http, type Schemas } from '@/api/http';
import { CrudPage } from '@/components/crud';
import { Badge, DataTable, QueryState } from '@/components/ui';
import { personLabel } from '@/lib/fields';
import { formatDay } from '@/lib/format';

const statusBadge: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  valid: { label: 'Valid', tone: 'success' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
  missing: { label: 'Missing', tone: 'danger' },
};

const typeLabel = ((t: Schemas['CertificationType']) => (t.code ? `${t.name} (${t.code})` : t.name)) as (
  row: never,
) => string;

export function Certifications() {
  const compliance = useQuery({
    queryKey: ['/api/v1/certifications/compliance/'],
    queryFn: () => http.get<Schemas['Compliance'][]>('/api/v1/certifications/compliance/'),
  });

  return (
    <div className="stack">
      <section className="stack-sm">
        <h2>Needs attention</h2>
        <p className="muted small">
          Certifications expiring within 60 days, already expired, or required for everyone but not on file.
        </p>
        <QueryState query={compliance}>
          {(rows) => (
            <DataTable
              rows={rows.map((r) => ({ ...r, id: r.user }))}
              empty="Everyone is current."
              columns={[
                { header: 'Member', cell: (r) => <strong>{r.name}</strong> },
                {
                  header: 'Issues',
                  cell: (r) => (
                    <div className="row">
                      {r.problems.map((p) => (
                        <span key={p.certification_type} className="row" style={{ gap: 4 }}>
                          <Badge tone={statusBadge[p.status].tone}>{statusBadge[p.status].label}</Badge>
                          {p.type_name}
                          {p.expires_on ? (
                            <span className="muted small">({formatDay(p.expires_on, { year: 'numeric' })})</span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </QueryState>
      </section>

      <section className="stack-sm">
        <h2>All certifications</h2>
        <CrudPage<Schemas['Certification']>
          header={false}
          title="Certifications"
          noun="certification"
          endpoint="/api/v1/certifications/"
          fields={[
            {
              name: 'user',
              label: 'Member',
              type: 'relation',
              required: true,
              endpoint: '/api/v1/users/',
              query: { is_active: true },
              optionLabel: personLabel as (row: never) => string,
            },
            {
              name: 'certification_type',
              label: 'Certification',
              type: 'relation',
              required: true,
              endpoint: '/api/v1/certification-types/',
              optionLabel: typeLabel,
            },
            { name: 'number', label: 'Certificate number', type: 'text' },
            { name: 'issued_on', label: 'Issued', type: 'date' },
            {
              name: 'expires_on',
              label: 'Expires',
              type: 'date',
              help: "Blank: calculated from the type's renewal period, or never expires",
            },
            { name: 'notes', label: 'Notes', type: 'text', wide: true },
          ]}
          columns={[
            { header: 'Member', cell: (c) => <strong>{c.user_name}</strong> },
            { header: 'Certification', cell: (c) => c.type_name },
            { header: 'Number', cell: (c) => c.number },
            { header: 'Issued', cell: (c) => (c.issued_on ? formatDay(c.issued_on, { year: 'numeric' }) : '') },
            { header: 'Expires', cell: (c) => (c.expires_on ? formatDay(c.expires_on, { year: 'numeric' }) : 'Never') },
            {
              header: 'Status',
              cell: (c) => <Badge tone={statusBadge[c.status].tone}>{statusBadge[c.status].label}</Badge>,
            },
          ]}
        />
      </section>
    </div>
  );
}

export function CertificationTypes() {
  return (
    <CrudPage<Schemas['CertificationType']>
      header={false}
      title="Certification types"
      noun="certification type"
      endpoint="/api/v1/certification-types/"
      fields={[
        { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g. Paramedic' },
        { name: 'code', label: 'Short code', type: 'text', placeholder: 'e.g. NRP' },
        {
          name: 'renewal_months',
          label: 'Renew every (months)',
          type: 'number',
          step: '1',
          min: 1,
          help: 'Used to fill in expiration dates',
        },
        { name: 'required_for_all', label: 'Required for every active member', type: 'checkbox' },
        { name: 'notes', label: 'Notes', type: 'textarea' },
      ]}
      columns={[
        { header: 'Name', cell: (t) => <strong>{t.name}</strong> },
        { header: 'Code', cell: (t) => t.code },
        { header: 'Renewal', cell: (t) => (t.renewal_months ? `${t.renewal_months} months` : '—') },
        { header: '', cell: (t) => (t.required_for_all ? <Badge tone="warning">Required for all</Badge> : null) },
      ]}
    />
  );
}
