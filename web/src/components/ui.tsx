import { type ReactNode, useEffect, useRef } from 'react';

import { ApiError } from '@/api/http';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="stack-sm">
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  small?: boolean;
  loading?: boolean;
};

export function Button({ variant = 'secondary', small, loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={['btn', `btn-${variant}`, small && 'btn-sm', className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}>
      {loading ? '…' : children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={['card', className].filter(Boolean).join(' ')}>{children}</section>;
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <Card>
      <div className={`stat-value ${tone ? `tone-${tone}` : ''}`}>{value}</div>
      <div className="muted small">{label}</div>
    </Card>
  );
}

export function Loading() {
  return <div className="spinner" role="status" aria-label="Loading" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="alert row spread" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <Button small onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Loading / error / content for a react-query result. Loaded data is passed to
 * `children` so callers never read `query.data!` before it exists.
 */
export function QueryState<T>({
  query,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown };
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data as T)}</>;
}

export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T extends { id?: number | string }>({
  rows,
  columns,
  onRowClick,
  empty = 'Nothing here yet.',
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={c.className}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? i}
              className={onRowClick ? 'clickable' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}>
              {columns.map((c) => (
                <td key={c.header} className={c.className}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** For tables and other wide content. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onClose={onClose} aria-labelledby="modal-title">
      {open ? (
        <>
          <div className="modal-head">
            <h2 id="modal-title">{title}</h2>
            <Button variant="ghost" small onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </div>
          <div className="modal-body">{children}</div>
          {footer ? <div className="modal-foot">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={`tab ${o.value === value ? 'active' : ''}`}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function fieldErrors(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fieldErrors : {};
}
