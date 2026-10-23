import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getAll, http, type Schemas } from '@/api/http';
import { CrudPage, RecordModal } from '@/components/crud';
import type { FieldSpec } from '@/components/form';
import { Badge, Button, DataTable, ErrorBox, fieldErrors, Modal, PageHeader, QueryState, Tabs } from '@/components/ui';
import { stationLabel } from '@/lib/fields';
import { formatDateTime, formatDay, humanize, isoDate } from '@/lib/format';
import { itemCategories, labelFor } from '@/lib/labels';

type Tab = 'stock' | 'items' | 'locations' | 'activity';

export default function Inventory() {
  const [tab, setTab] = useState<Tab>('stock');
  return (
    <div>
      <PageHeader title="Inventory" subtitle="Supplies, EMS stock and equipment across stations and rigs." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'stock', label: 'Stock levels' },
          { value: 'items', label: 'Item catalog' },
          { value: 'locations', label: 'Storage locations' },
          { value: 'activity', label: 'Activity' },
        ]}
      />
      {tab === 'stock' ? <StockTab /> : null}
      {tab === 'items' ? <ItemsTab /> : null}
      {tab === 'locations' ? <LocationsTab /> : null}
      {tab === 'activity' ? <ActivityTab /> : null}
    </div>
  );
}

const itemLabel = ((i: Schemas['Item']) => i.name) as (row: never) => string;
const locationLabel = ((l: Schemas['StorageLocation']) => l.label) as (row: never) => string;

type StockFilter = 'all' | 'below_par' | 'expiring';

function StockTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StockFilter>('all');
  const [search, setSearch] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Schemas['StockLevel'] | null>(null);
  const [adding, setAdding] = useState(false);

  const locations = useQuery({
    queryKey: ['/api/v1/inventory/locations/'],
    queryFn: () => getAll<Schemas['StorageLocation']>('/api/v1/inventory/locations/'),
  });
  const query = { search: search || undefined, location: location || undefined, item__category: category || undefined };
  const stock = useQuery({
    queryKey: ['/api/v1/inventory/stock/', filter, query],
    queryFn: () =>
      filter === 'expiring'
        ? http.get<Schemas['StockLevel'][]>('/api/v1/inventory/stock/expiring/', { days: 60, ...query })
        : getAll<Schemas['StockLevel']>('/api/v1/inventory/stock/', {
            below_par: filter === 'below_par' || undefined,
            ...query,
          }),
  });

  const today = isoDate();
  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search items, SKU, barcode…"
          aria-label="Search stock"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)}>
          <option value="">All locations</option>
          {(locations.data ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {itemCategories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as StockFilter)}>
          <option value="all">All stock</option>
          <option value="below_par">Below par only</option>
          <option value="expiring">Expiring within 60 days</option>
        </select>
        <span style={{ flex: 1 }} />
        <Button variant="primary" onClick={() => setAdding(true)}>
          Stock an item
        </Button>
      </div>
      <QueryState query={stock}>
        {(rows) => (
          <DataTable
            rows={rows}
            onRowClick={setSelected}
            empty="No stock matches."
            columns={[
              { header: 'Item', cell: (s) => <strong>{s.item_name}</strong> },
              { header: 'Location', cell: (s) => s.location_label },
              {
                header: 'On hand',
                className: 'num',
                cell: (s) => (
                  <span className={s.below_par ? 'tone-warning' : ''} style={{ fontWeight: 700 }}>
                    {s.quantity} {s.unit}
                  </span>
                ),
              },
              { header: 'Par', className: 'num', cell: (s) => s.par_level },
              {
                header: 'Expires',
                cell: (s) =>
                  s.expires_on ? (
                    <Badge tone={s.expires_on < today ? 'danger' : 'neutral'}>
                      {formatDay(s.expires_on, { year: 'numeric' })}
                    </Badge>
                  ) : (
                    ''
                  ),
              },
              { header: '', cell: (s) => (s.below_par ? <Badge tone="warning">Below par</Badge> : null) },
            ]}
          />
        )}
      </QueryState>
      {selected ? (
        <StockModal
          stock={selected}
          onClose={() => setSelected(null)}
          onChanged={() => queryClient.invalidateQueries()}
        />
      ) : null}
      {adding ? (
        <RecordModal<Schemas['StockLevel']>
          title="Stock an item at a location"
          endpoint="/api/v1/inventory/stock/"
          record={null}
          fields={[
            {
              name: 'item',
              label: 'Item',
              type: 'relation',
              endpoint: '/api/v1/inventory/items/',
              optionLabel: itemLabel,
              required: true,
            },
            {
              name: 'location',
              label: 'Location',
              type: 'relation',
              endpoint: '/api/v1/inventory/locations/',
              optionLabel: locationLabel,
              required: true,
            },
            { name: 'quantity', label: 'Quantity on hand', type: 'number', step: '1', min: 0 },
            {
              name: 'par_level',
              label: 'Par level',
              type: 'number',
              step: '1',
              min: 0,
              help: 'Flag when stock falls below this',
            },
            { name: 'expires_on', label: 'Earliest expiration', type: 'date' },
          ]}
          defaults={{ quantity: '0', par_level: '0' }}
          onClose={() => setAdding(false)}
          onSaved={() => {
            queryClient.invalidateQueries();
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}

const reasons = [
  { value: 'restock', label: 'Restock / received', sign: 1 },
  { value: 'used', label: 'Used', sign: -1 },
  { value: 'expired', label: 'Expired / disposed', sign: -1 },
  { value: 'damaged', label: 'Damaged / lost', sign: -1 },
  { value: 'transfer_in', label: 'Transfer in', sign: 1 },
  { value: 'transfer_out', label: 'Transfer out', sign: -1 },
  { value: 'count', label: 'Count correction (set on-hand)', sign: 0 },
];

function StockModal({
  stock,
  onClose,
  onChanged,
}: {
  stock: Schemas['StockLevel'];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState(stock);
  const [reason, setReason] = useState('used');
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const [par, setPar] = useState(String(stock.par_level ?? 0));
  const [expires, setExpires] = useState(stock.expires_on ?? '');

  const history = useQuery({
    queryKey: ['/api/v1/inventory/transactions/', { stock: stock.id }],
    queryFn: () =>
      http.get<{ results: Schemas['StockTransaction'][] }>('/api/v1/inventory/transactions/', {
        stock: stock.id,
        page_size: 20,
      }),
  });

  const sign = reasons.find((r) => r.value === reason)!.sign;
  const n = Number.parseInt(amount, 10);
  const change = sign === 0 ? n - (current.quantity ?? 0) : sign * n;
  const valid = Number.isInteger(n) && n >= 0 && change !== 0;

  const adjust = useMutation({
    mutationFn: () =>
      http.post<Schemas['StockAdjustmentResult']>(`/api/v1/inventory/stock/${stock.id}/adjust/`, {
        change,
        reason,
        note,
      }),
    onSuccess: (result) => {
      setCurrent(result.stock);
      setNote('');
      setAmount('1');
      history.refetch();
      onChanged();
    },
  });
  const update = useMutation({
    mutationFn: () =>
      http.patch<Schemas['StockLevel']>(`/api/v1/inventory/stock/${stock.id}/`, {
        par_level: Number(par),
        expires_on: expires || null,
      }),
    onSuccess: (result) => {
      setCurrent(result);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/api/v1/inventory/stock/${stock.id}/`),
    onSuccess: () => {
      onChanged();
      onClose();
    },
  });

  return (
    <Modal title={`${current.item_name} · ${current.location_label}`} open onClose={onClose}>
      <div className="stack">
        <div className="row spread">
          <div>
            <div className="stat-value">
              {current.quantity} <span className="muted small">{current.unit}</span>
            </div>
            <div className="muted small">on hand · par {current.par_level}</div>
          </div>
          {current.below_par ? <Badge tone="warning">Below par</Badge> : null}
        </div>

        <form
          className="stack-sm card"
          onSubmit={(e) => {
            e.preventDefault();
            adjust.mutate();
          }}>
          <h3>Record a change</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="reason">What happened</label>
              <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {reasons.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="amount">{sign === 0 ? 'Counted on hand' : 'Quantity'}</label>
              <input
                id="amount"
                type="number"
                min={0}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="field span-all">
              <label htmlFor="note">Note</label>
              <input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional, e.g. PO number or run number"
              />
            </div>
          </div>
          <ErrorBox error={adjust.error} />
          <div className="row">
            <Button variant="primary" type="submit" disabled={!valid} loading={adjust.isPending}>
              {valid ? `Save ${change > 0 ? '+' : ''}${change}` : 'Save'}
            </Button>
          </div>
        </form>

        <form
          className="stack-sm card"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate();
          }}>
          <h3>Settings</h3>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="par">Par level</label>
              <input id="par" type="number" min={0} step={1} value={par} onChange={(e) => setPar(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="expires">Earliest expiration</label>
              <input id="expires" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
              {fieldErrors(update.error).expires_on ? (
                <span className="field-error">{fieldErrors(update.error).expires_on}</span>
              ) : null}
            </div>
          </div>
          <ErrorBox error={update.error} />
          <div className="row spread">
            <Button type="submit" loading={update.isPending}>
              Save settings
            </Button>
            <Button
              variant="danger"
              small
              loading={remove.isPending}
              onClick={() =>
                window.confirm('Stop tracking this item at this location? Its history is deleted too.') &&
                remove.mutate()
              }>
              Remove from location
            </Button>
          </div>
        </form>

        <div className="stack-sm">
          <h3>History</h3>
          <QueryState query={history}>
            {(page) => (
              <DataTable
                rows={page.results}
                empty="No changes yet."
                columns={[
                  { header: 'When', cell: (t) => formatDateTime(t.created_at) },
                  {
                    header: 'Change',
                    className: 'num',
                    cell: (t) => (
                      <span className={t.change > 0 ? 'tone-success' : ''}>
                        {t.change > 0 ? `+${t.change}` : t.change}
                      </span>
                    ),
                  },
                  { header: 'Reason', cell: (t) => humanize(t.reason) },
                  { header: 'Note', cell: (t) => t.note },
                ]}
              />
            )}
          </QueryState>
        </div>
      </div>
    </Modal>
  );
}

function ItemsTab() {
  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, wide: true },
    { name: 'category', label: 'Category', type: 'select', options: itemCategories, required: true },
    { name: 'unit', label: 'Unit', type: 'text', placeholder: 'each, box, case…', required: true },
    { name: 'sku', label: 'SKU / part number', type: 'text' },
    { name: 'barcode', label: 'Barcode', type: 'text', help: 'Scanned from the mobile app' },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'tracks_expiration', label: 'Track expiration dates', type: 'checkbox' },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ];
  return (
    <CrudPage<Schemas['Item']>
      header={false}
      title="Items"
      noun="item"
      endpoint="/api/v1/inventory/items/"
      fields={fields}
      defaults={{ category: 'ems', unit: 'each', is_active: true }}
      filters={[{ name: 'category', label: 'Category', options: itemCategories }]}
      columns={[
        { header: 'Name', cell: (i) => <strong>{i.name}</strong> },
        { header: 'Category', cell: (i) => labelFor(itemCategories, i.category) },
        { header: 'Unit', cell: (i) => i.unit },
        { header: 'SKU', cell: (i) => i.sku },
        { header: 'Barcode', cell: (i) => i.barcode },
        { header: '', cell: (i) => (i.is_active ? null : <Badge>Inactive</Badge>) },
      ]}
    />
  );
}

function LocationsTab() {
  return (
    <CrudPage<Schemas['StorageLocation']>
      header={false}
      title="Locations"
      noun="location"
      search={false}
      endpoint="/api/v1/inventory/locations/"
      fields={[
        {
          name: 'name',
          label: 'Name',
          type: 'text',
          required: true,
          placeholder: 'e.g. EMS supply room, Compartment R2',
        },
        {
          name: 'station',
          label: 'At station',
          type: 'relation',
          endpoint: '/api/v1/stations/',
          optionLabel: stationLabel as (row: never) => string,
          help: 'Pick a station or an apparatus, not both',
        },
        {
          name: 'apparatus',
          label: 'On apparatus',
          type: 'relation',
          endpoint: '/api/v1/apparatus/',
          optionLabel: ((a: Schemas['Apparatus']) => a.unit_number) as (row: never) => string,
        },
      ]}
      columns={[{ header: 'Location', cell: (l) => <strong>{l.label}</strong> }]}
    />
  );
}

function ActivityTab() {
  const [reason, setReason] = useState('');
  const activity = useQuery({
    queryKey: ['/api/v1/inventory/transactions/', reason],
    queryFn: () =>
      http.get<{ results: Schemas['StockTransaction'][] }>('/api/v1/inventory/transactions/', {
        reason: reason || undefined,
        page_size: 100,
      }),
  });
  const people = useQuery({ queryKey: ['/api/v1/users/'], queryFn: () => getAll<Schemas['User']>('/api/v1/users/') });
  const name = (id: number | null | undefined) => {
    const u = people.data?.find((p) => p.id === id);
    return u ? u.full_name || u.username : '';
  };
  return (
    <div>
      <div className="toolbar">
        <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="">All changes</option>
          {reasons.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="muted small">Latest 100 changes</span>
      </div>
      <QueryState query={activity}>
        {(page) => (
          <DataTable
            rows={page.results}
            empty="No stock changes yet."
            columns={[
              { header: 'When', cell: (t) => formatDateTime(t.created_at) },
              { header: 'Item', cell: (t) => t.item_name },
              { header: 'Location', cell: (t) => t.location_label },
              {
                header: 'Change',
                className: 'num',
                cell: (t) => (
                  <span className={t.change > 0 ? 'tone-success' : ''}>{t.change > 0 ? `+${t.change}` : t.change}</span>
                ),
              },
              { header: 'Reason', cell: (t) => humanize(t.reason) },
              { header: 'By', cell: (t) => name(t.performed_by) },
              { header: 'Note', cell: (t) => t.note },
            ]}
          />
        )}
      </QueryState>
    </div>
  );
}
