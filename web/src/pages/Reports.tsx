import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { http, type Schemas, withQuery } from '@/api/http';
import { DataTable, PageHeader, QueryState, Tabs } from '@/components/ui';
import { addDays, isoDate } from '@/lib/format';

type Range = { start: string; end: string };

function presets(): { label: string; range: Range }[] {
  const today = isoDate();
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarterStart = `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
  return [
    { label: 'Year to date', range: { start: `${year}-01-01`, end: today } },
    { label: 'Quarter to date', range: { start: quarterStart, end: today } },
    { label: 'Last 30 days', range: { start: addDays(today, -29), end: today } },
    { label: 'Last year', range: { start: `${year - 1}-01-01`, end: `${year - 1}-12-31` } },
  ];
}

/** Show numbers (including decimal strings from the API) with thousands separators and no trailing zeros. */
function display(value: unknown) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value).toLocaleString();
  return String(value);
}

export default function Reports() {
  const list = useQuery({
    queryKey: ['/api/v1/reports/'],
    queryFn: () => http.get<Schemas['ReportInfo'][]>('/api/v1/reports/'),
  });
  const [slug, setSlug] = useState('fleet');
  const [range, setRange] = useState<Range>(presets()[0].range);

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Numbers for budget meetings, ISO reviews and the board. Download any report as CSV."
      />
      <QueryState query={list}>
        {(reports) => {
          const info = reports.find((r) => r.slug === slug) ?? reports[0];
          return (
            <>
              <Tabs
                value={info.slug}
                onChange={setSlug}
                options={reports.map((r) => ({ value: r.slug, label: r.title }))}
              />
              <p className="muted" style={{ marginBottom: 12 }}>
                {info.description}
              </p>
              <div className="toolbar">
                {info.uses_dates ? (
                  <>
                    <select
                      aria-label="Period"
                      value=""
                      onChange={(e) => {
                        const preset = presets().find((p) => p.label === e.target.value);
                        if (preset) setRange(preset.range);
                      }}>
                      <option value="">Quick range…</option>
                      {presets().map((p) => (
                        <option key={p.label}>{p.label}</option>
                      ))}
                    </select>
                    <label className="field-label" htmlFor="r-start">
                      From
                    </label>
                    <input
                      id="r-start"
                      type="date"
                      value={range.start}
                      onChange={(e) => e.target.value && setRange({ ...range, start: e.target.value })}
                    />
                    <label className="field-label" htmlFor="r-end">
                      to
                    </label>
                    <input
                      id="r-end"
                      type="date"
                      value={range.end}
                      onChange={(e) => e.target.value && setRange({ ...range, end: e.target.value })}
                    />
                  </>
                ) : (
                  <span className="muted small">As of today</span>
                )}
                <span style={{ flex: 1 }} />
                <a
                  className="btn btn-secondary"
                  href={withQuery(`/api/v1/reports/${info.slug}/`, {
                    ...(info.uses_dates ? range : {}),
                    export: 'csv',
                  })}
                  download>
                  Download CSV
                </a>
              </div>
              <ReportTable slug={info.slug} range={info.uses_dates ? range : null} />
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function ReportTable({ slug, range }: { slug: string; range: Range | null }) {
  const report = useQuery({
    queryKey: ['/api/v1/reports/', slug, range],
    queryFn: () => http.get<Schemas['Report']>(`/api/v1/reports/${slug}/`, range ?? {}),
  });
  return (
    <QueryState query={report}>
      {(r) => (
        <DataTable
          rows={r.rows.map((row, id) => ({ ...(row as Record<string, unknown>), id }))}
          empty="No data for this period."
          columns={r.columns.map((c, i) => ({
            header: c.label,
            className: i > 0 ? 'num' : undefined,
            cell: (row: Record<string, unknown>) =>
              i === 0 ? <strong>{display(row[c.key])}</strong> : display(row[c.key]),
          }))}
        />
      )}
    </QueryState>
  );
}
