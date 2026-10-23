import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { ApiError, http, type Schemas } from '@/api/http';
import { Badge, Button, Card, DataTable, ErrorBox, PageHeader, QueryState, Tabs } from '@/components/ui';

type Report = Schemas['ImportReport'];
type Kind = Schemas['ImportKind'];

const actionTone = { create: 'success', update: 'neutral', skip: 'neutral', error: 'danger' } as const;
const actionLabel = { create: 'New', update: 'Update', skip: 'Skip', error: 'Error' } as const;

export default function Import() {
  const kinds = useQuery({ queryKey: ['/api/v1/imports/'], queryFn: () => http.get<Kind[]>('/api/v1/imports/') });
  const [kind, setKind] = useState('people');

  return (
    <div>
      <PageHeader
        title="Import data"
        subtitle="Bring in people, apparatus and inventory from ESO exports or your own spreadsheets (CSV or Excel). You'll see a preview before anything is saved."
      />
      <QueryState query={kinds}>
        {(list) => (
          <>
            <Tabs value={kind} onChange={setKind} options={list.map((k) => ({ value: k.kind, label: k.title }))} />
            {/* Remount per kind so the chosen file and preview reset. */}
            <Importer key={kind} kind={list.find((k) => k.kind === kind)!} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function Importer({ kind }: { kind: Kind }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const send = (commit: boolean, skipErrors = false) => {
    const form = new FormData();
    form.append('file', file!);
    if (commit) form.append('commit', 'true');
    if (skipErrors) form.append('skip_errors', 'true');
    return http.upload<Report>(`/api/v1/imports/${kind.kind}/`, form);
  };
  const preview = useMutation({ mutationFn: () => send(false) });
  const commit = useMutation({
    mutationFn: (skipErrors: boolean) => send(true, skipErrors),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const report = commit.data ?? preview.data;
  const fileError = (preview.error ?? commit.error) instanceof ApiError ? (preview.error ?? commit.error) : null;
  const s = report?.summary ?? {};
  const valid = (s.create ?? 0) + (s.update ?? 0);

  return (
    <div className="stack">
      <Card>
        <div className="stack-sm">
          <p>{kind.description}</p>
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>
              Columns we recognize
            </summary>
            <DataTable
              rows={kind.columns.map((c) => ({ ...c, id: c.key }))}
              columns={[
                { header: 'Column', cell: (c) => <strong>{c.label}</strong> },
                {
                  header: 'Also accepted as',
                  cell: (c) => <span className="muted small">{c.aliases.join(', ')}</span>,
                },
                { header: 'Notes', cell: (c) => (c.required ? <Badge tone="warning">Required</Badge> : c.help) },
              ]}
            />
          </details>
          <div className="row">
            <a className="btn btn-secondary btn-sm" href={`/api/v1/imports/${kind.kind}/template/`} download>
              Download template (CSV)
            </a>
          </div>
        </div>
      </Card>

      <Card>
        <div className="stack-sm">
          <h2>1. Choose a file</h2>
          <div className="row">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.xlsx,.xlsm,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="Spreadsheet file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                preview.reset();
                commit.reset();
              }}
              style={{ width: 'auto' }}
            />
            <Button variant="primary" disabled={!file} loading={preview.isPending} onClick={() => preview.mutate()}>
              Preview import
            </Button>
          </div>
          <ErrorBox error={fileError} />
        </div>
      </Card>

      {report ? (
        <Card>
          <div className="stack">
            <h2>{report.committed ? 'Imported' : '2. Review'}</h2>
            {report.committed ? (
              <div className="notice">
                Saved {valid} row{valid === 1 ? '' : 's'}
                {s.error ? `; skipped ${s.error} with errors` : ''}.
              </div>
            ) : null}
            {report.missing.length ? (
              <div className="alert">
                Missing required column{report.missing.length > 1 ? 's' : ''}: {report.missing.join(', ')}. Rename the
                matching header in your file (or download the template) and try again.
              </div>
            ) : (
              <>
                <div className="row">
                  <Badge tone="success">{s.create ?? 0} new</Badge>
                  <Badge>{s.update ?? 0} updates</Badge>
                  <Badge tone={s.error ? 'danger' : 'neutral'}>{s.error ?? 0} with errors</Badge>
                </div>
                <div className="small muted">
                  Using columns:{' '}
                  {Object.entries(report.recognized)
                    .map(([header, column]) => (header === column ? header : `${header} → ${column}`))
                    .join(', ')}
                  {report.ignored.length ? (
                    <>
                      <br />
                      Ignoring: {report.ignored.join(', ')}
                    </>
                  ) : null}
                </div>
                <label className="checkbox">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
                  Show only rows with errors or notes
                </label>
                <DataTable
                  rows={report.rows
                    .filter((r) => !onlyProblems || r.errors.length || r.notes.length)
                    .map((r) => ({ ...r, id: r.line }))}
                  empty="No rows."
                  columns={[
                    { header: 'Row', cell: (r) => r.line, className: 'num' },
                    { header: '', cell: (r) => <Badge tone={actionTone[r.action]}>{actionLabel[r.action]}</Badge> },
                    { header: 'Record', cell: (r) => r.label },
                    {
                      header: 'Details',
                      cell: (r) => (
                        <div>
                          {r.errors.map((e) => (
                            <div key={e} className="tone-danger">
                              {e}
                            </div>
                          ))}
                          {r.notes.map((n) => (
                            <div key={n} className="muted small">
                              {n}
                            </div>
                          ))}
                        </div>
                      ),
                    },
                  ]}
                />
                {!report.committed ? (
                  <div className="row">
                    {s.error ? (
                      <>
                        <span className="muted small">Fix the errors in your file and preview again, or:</span>
                        <Button
                          variant="primary"
                          disabled={!valid}
                          loading={commit.isPending}
                          onClick={() => commit.mutate(true)}>
                          Import {valid} valid rows, skip {s.error}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={!valid}
                        loading={commit.isPending}
                        onClick={() => commit.mutate(false)}>
                        Import {valid} rows
                      </Button>
                    )}
                  </div>
                ) : (
                  <div>
                    <Button
                      onClick={() => {
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = '';
                        preview.reset();
                        commit.reset();
                      }}>
                      Import another file
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
