import { useQuery } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { getAll } from '@/api/http';

import { ErrorBox, fieldErrors } from './ui';

export type Option = { value: string; label: string };
export type Values = Record<string, unknown>;

type Base = { name: string; label: string; required?: boolean; help?: string; placeholder?: string; wide?: boolean };

export type FieldSpec =
  | (Base & { type: 'text' | 'email' | 'password' | 'textarea' | 'date' | 'time' | 'color' })
  | (Base & { type: 'number'; step?: string; min?: number })
  | (Base & { type: 'datetime' })
  | (Base & { type: 'checkbox' })
  | (Base & { type: 'select'; options: Option[] })
  | (Base & {
      type: 'relation';
      endpoint: string;
      query?: Record<string, string | number | boolean>;
      optionLabel: (row: never) => string;
      multiple?: boolean;
    });

/** ISO timestamp → value for <input type="datetime-local"> in the viewer's time zone. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert raw input values into the JSON the API expects. */
export function toBody(fields: FieldSpec[], values: Values): Values {
  const body: Values = {};
  for (const field of fields) {
    const value = values[field.name];
    switch (field.type) {
      case 'number':
        body[field.name] = value === '' || value === undefined || value === null ? null : Number(value);
        break;
      case 'datetime':
        body[field.name] = value ? new Date(String(value)).toISOString() : null;
        break;
      case 'date':
        body[field.name] = value || null;
        break;
      case 'relation':
        if (field.multiple) body[field.name] = ((value as string[] | undefined) ?? []).map(Number);
        else body[field.name] = value === '' || value === undefined || value === null ? null : Number(value);
        break;
      case 'checkbox':
        body[field.name] = Boolean(value);
        break;
      default:
        body[field.name] = value ?? '';
    }
  }
  return body;
}

/** Turn an API record into input values for `fields`. */
export function toValues(fields: FieldSpec[], record: Values | undefined): Values {
  const values: Values = {};
  for (const field of fields) {
    const value = record?.[field.name];
    if (field.type === 'datetime') values[field.name] = toLocalInput(value as string | null);
    else if (field.type === 'checkbox') values[field.name] = Boolean(value);
    else if (field.type === 'relation' && field.multiple) values[field.name] = ((value as number[]) ?? []).map(String);
    else values[field.name] = value === null || value === undefined ? '' : String(value);
  }
  return values;
}

export function FormFields({
  fields,
  values,
  onChange,
  errors,
}: {
  fields: FieldSpec[];
  values: Values;
  onChange: (name: string, value: unknown) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="form-grid">
      {fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(v) => onChange(field.name, v)}
          error={errors[field.name]}
        />
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  error,
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const id = `f-${field.name}`;
  const common = {
    id,
    name: field.name,
    required: field.required,
    placeholder: field.placeholder,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-err` : undefined,
  } as const;
  const wide = field.wide || field.type === 'textarea' || (field.type === 'relation' && field.multiple);

  if (field.type === 'checkbox') {
    return (
      <div className={`field ${wide ? 'span-all' : ''}`}>
        <label className="checkbox">
          <input type="checkbox" id={id} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {field.label}
        </label>
        {field.help ? <span className="field-help">{field.help}</span> : null}
        {error ? <span className="field-error">{error}</span> : null}
      </div>
    );
  }

  let input;
  switch (field.type) {
    case 'textarea':
      input = <textarea {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      input = (
        <select {...common} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {!field.required ? <option value="">—</option> : null}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'relation':
      input = <RelationSelect field={field} common={common} value={value} onChange={onChange} />;
      break;
    case 'datetime':
      input = (
        <input
          {...common}
          type="datetime-local"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case 'number':
      input = (
        <input
          {...common}
          type="number"
          step={field.step ?? 'any'}
          min={field.min}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    default:
      input = (
        <input {...common} type={field.type} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
      );
  }

  return (
    <div className={`field ${wide ? 'span-all' : ''}`}>
      <label htmlFor={id}>
        {field.label}
        {field.required ? ' *' : ''}
      </label>
      {input}
      {field.help ? <span className="field-help">{field.help}</span> : null}
      {error ? (
        <span className="field-error" id={`${id}-err`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function RelationSelect({
  field,
  common,
  value,
  onChange,
}: {
  field: Extract<FieldSpec, { type: 'relation' }>;
  common: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = useQuery({
    queryKey: ['options', field.endpoint, field.query],
    queryFn: () => getAll<{ id: number }>(field.endpoint, field.query),
  });
  const rows = options.data ?? [];
  const label = field.optionLabel as (row: unknown) => string;

  if (field.multiple) {
    const selected = new Set((value as string[] | undefined) ?? []);
    return (
      <select
        {...common}
        multiple
        size={Math.min(8, Math.max(3, rows.length))}
        value={[...selected]}
        onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}>
        {rows.map((row) => (
          <option key={row.id} value={String(row.id)}>
            {label(row)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <select
      {...common}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      disabled={options.isPending}>
      <option value="">{options.isPending ? 'Loading…' : '—'}</option>
      {rows.map((row) => (
        <option key={row.id} value={String(row.id)}>
          {label(row)}
        </option>
      ))}
    </select>
  );
}

export function Form({
  id,
  fields,
  values,
  onChange,
  onSubmit,
  error,
}: {
  id: string;
  fields: FieldSpec[];
  values: Values;
  onChange: (name: string, value: unknown) => void;
  onSubmit: () => void;
  error: unknown;
}) {
  const errors = fieldErrors(error);
  const known = new Set(fields.map((f) => f.name));
  // Errors on fields this form doesn't show (or non-field errors) go in the banner.
  const showBanner = error && Object.keys(errors).every((k) => !known.has(k));
  return (
    <form
      id={id}
      className="stack"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit();
      }}>
      {showBanner ? <ErrorBox error={error} /> : null}
      <FormFields fields={fields} values={values} onChange={onChange} errors={errors} />
    </form>
  );
}
