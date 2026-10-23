import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { getAll, http } from '@/api/http';

import { type FieldSpec, Form, toBody, toValues, type Values } from './form';
import { Button, type Column, DataTable, Modal, PageHeader, QueryState } from './ui';

export type Filter = { name: string; label: string; options: { value: string; label: string }[] };

type Row = { id: number };

/**
 * A list of department records with search, filters, and create / edit / delete
 * in a modal. Used for the setup screens.
 */
export function CrudPage<T extends Row>({
  title,
  subtitle,
  endpoint,
  columns,
  fields,
  noun,
  canWrite = true,
  canDelete = true,
  search = true,
  filters = [],
  defaults = {},
  prepare,
  onRowClick,
  actions,
  header = true,
}: {
  title: string;
  subtitle?: ReactNode;
  endpoint: string;
  columns: Column<T>[];
  fields: FieldSpec[];
  /** Singular name used on buttons, e.g. "station". */
  noun: string;
  canWrite?: boolean;
  canDelete?: boolean;
  search?: boolean;
  filters?: Filter[];
  defaults?: Values;
  /** Adjust the request body before saving. */
  prepare?: (body: Values, editing: T | null) => Values;
  /** Override the default (open the edit form). */
  onRowClick?: (row: T) => void;
  actions?: ReactNode;
  header?: boolean;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);

  const list = useQuery({
    queryKey: [endpoint, { query, ...filterValues }],
    queryFn: () => getAll<T>(endpoint, { search: query || undefined, ...filterValues }),
  });

  const open = creating || editing !== null;
  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  return (
    <div>
      {header ? (
        <PageHeader
          title={title}
          subtitle={subtitle}
          actions={
            <>
              {actions}
              {canWrite ? (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Add {noun}
                </Button>
              ) : null}
            </>
          }
        />
      ) : canWrite ? (
        <div className="row spread" style={{ marginBottom: 12 }}>
          <div className="row">{actions}</div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add {noun}
          </Button>
        </div>
      ) : null}

      {search || filters.length ? (
        <div className="toolbar">
          {search ? (
            <input
              type="search"
              placeholder="Search…"
              aria-label={`Search ${title.toLowerCase()}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          ) : null}
          {filters.map((f) => (
            <select
              key={f.name}
              aria-label={f.label}
              value={filterValues[f.name] ?? ''}
              onChange={(e) => setFilterValues((prev) => ({ ...prev, [f.name]: e.target.value }))}>
              <option value="">{f.label}: all</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ))}
        </div>
      ) : null}

      <QueryState query={list}>
        {(rows) => (
          <DataTable
            rows={rows}
            columns={columns}
            onRowClick={onRowClick ?? (canWrite ? setEditing : undefined)}
            empty={query ? `Nothing matches "${query}".` : `No ${noun}s yet.`}
          />
        )}
      </QueryState>

      {open ? (
        <RecordModal<T>
          key={editing?.id ?? 'new'}
          title={editing ? `Edit ${noun}` : `Add ${noun}`}
          endpoint={endpoint}
          fields={fields}
          record={editing}
          defaults={defaults}
          prepare={prepare}
          canDelete={canDelete}
          onClose={close}
          onSaved={() => {
            queryClient.invalidateQueries();
            close();
          }}
        />
      ) : null}
    </div>
  );
}

export function RecordModal<T extends Row>({
  title,
  endpoint,
  fields,
  record,
  defaults = {},
  prepare,
  canDelete = true,
  onClose,
  onSaved,
}: {
  title: string;
  endpoint: string;
  fields: FieldSpec[];
  record: T | null;
  defaults?: Values;
  prepare?: (body: Values, editing: T | null) => Values;
  canDelete?: boolean;
  onClose: () => void;
  onSaved: (saved: T | null) => void;
}) {
  const [values, setValues] = useState<Values>(() =>
    record ? toValues(fields, record as unknown as Values) : { ...toValues(fields, undefined), ...defaults },
  );

  const save = useMutation({
    mutationFn: () => {
      let body = toBody(fields, values);
      if (prepare) body = prepare(body, record);
      return record ? http.patch<T>(`${endpoint}${record.id}/`, body) : http.post<T>(endpoint, body);
    },
    onSuccess: onSaved,
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`${endpoint}${record!.id}/`),
    onSuccess: () => onSaved(null),
  });

  return (
    <Modal
      title={title}
      open
      onClose={onClose}
      footer={
        <>
          <div>
            {record && canDelete ? (
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => window.confirm('Delete this? This cannot be undone.') && remove.mutate()}>
                Delete
              </Button>
            ) : null}
          </div>
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="record-form" loading={save.isPending}>
              Save
            </Button>
          </div>
        </>
      }>
      <Form
        id="record-form"
        fields={fields}
        values={values}
        onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
        onSubmit={() => save.mutate()}
        error={save.error ?? remove.error}
      />
    </Modal>
  );
}
