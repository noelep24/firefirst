import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getAll, http, type Schemas } from '@/api/http';
import { Badge, Button, DataTable, ErrorBox, fieldErrors, Modal, PageHeader, QueryState } from '@/components/ui';
import { apparatusTypes, labelFor } from '@/lib/labels';

type Template = Schemas['ChecklistTemplate'];
type DraftItem = { key: string; id?: number; section: string; prompt: string };

let nextKey = 0;
const newKey = () => `new-${nextKey++}`;

export default function Checklists() {
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const templates = useQuery({
    queryKey: ['/api/v1/checklists/'],
    queryFn: () => getAll<Template>('/api/v1/checklists/'),
  });

  return (
    <div>
      <PageHeader
        title="Rig checklists"
        subtitle="The forms crews fill out on the mobile app. Problems they report open work orders automatically."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New checklist
          </Button>
        }
      />
      <QueryState query={templates}>
        {(rows) => (
          <DataTable
            rows={rows}
            onRowClick={setEditing}
            empty="No checklists yet. Create one for your engines, ambulances or all rigs."
            columns={[
              { header: 'Name', cell: (t) => <strong>{t.name}</strong> },
              {
                header: 'Used for',
                cell: (t) => (t.apparatus_type ? labelFor(apparatusTypes, t.apparatus_type) : 'All apparatus'),
              },
              { header: 'Items', cell: (t) => t.items.length, className: 'num' },
              {
                header: 'Sections',
                cell: (t) => [...new Set(t.items.map((i) => i.section).filter(Boolean))].join(', '),
              },
              { header: '', cell: (t) => (t.is_active ? null : <Badge>Inactive</Badge>) },
            ]}
          />
        )}
      </QueryState>
      {editing ? (
        <ChecklistEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function ChecklistEditor({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [type, setType] = useState<string>(template?.apparatus_type ?? '');
  const [active, setActive] = useState(template?.is_active ?? true);
  const [items, setItems] = useState<DraftItem[]>(
    template?.items.map((i) => ({ key: `id-${i.id}`, id: i.id, section: i.section ?? '', prompt: i.prompt })) ?? [
      { key: newKey(), section: '', prompt: '' },
    ],
  );

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        apparatus_type: type,
        is_active: active,
        items: items
          .filter((i) => i.prompt.trim())
          .map((i, order) => ({
            ...(i.id ? { id: i.id } : {}),
            section: i.section.trim(),
            prompt: i.prompt.trim(),
            order,
          })),
      };
      return template ? http.patch(`/api/v1/checklists/${template.id}/`, body) : http.post('/api/v1/checklists/', body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      onClose();
    },
  });

  const update = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const move = (index: number, delta: number) =>
    setItems((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  const addAfter = (index: number) =>
    setItems((prev) => {
      const next = [...prev];
      // New items inherit the section of the item above, which is what you want when typing a list.
      next.splice(index + 1, 0, { key: newKey(), section: prev[index]?.section ?? '', prompt: '' });
      return next;
    });

  const errors = fieldErrors(save.error);
  return (
    <Modal
      title={template ? `Edit ${template.name}` : 'New checklist'}
      open
      onClose={onClose}
      footer={
        <>
          <span className="muted small">{items.filter((i) => i.prompt.trim()).length} items</span>
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
              Save checklist
            </Button>
          </div>
        </>
      }>
      <div className="stack">
        <ErrorBox error={save.error && !errors.name ? save.error : null} />
        <div className="form-grid">
          <div className="field">
            <label htmlFor="cl-name">Name *</label>
            <input
              id="cl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engine daily check"
            />
            {errors.name ? <span className="field-error">{errors.name}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="cl-type">Used for</label>
            <select id="cl-type" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All apparatus</option>
              {apparatusTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox span-all">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (offered to crews)
          </label>
        </div>

        <div className="stack-sm">
          <h3>Items</h3>
          <p className="muted small">
            Group items with a section name (Cab, Pump panel, Compartment R1…). Items already used in past checks are
            kept for the record even if you remove them here.
          </p>
          {items.map((item, index) => (
            <div key={item.key} className="checklist-item">
              <input
                aria-label={`Section for item ${index + 1}`}
                placeholder="Section"
                value={item.section}
                onChange={(e) => update(item.key, { section: e.target.value })}
              />
              <input
                aria-label={`Item ${index + 1}`}
                placeholder="What to check, e.g. Fuel at least 3/4"
                value={item.prompt}
                onChange={(e) => update(item.key, { prompt: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAfter(index);
                  }
                }}
              />
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Button
                  small
                  variant="ghost"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}>
                  ↑
                </Button>
                <Button
                  small
                  variant="ghost"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}>
                  ↓
                </Button>
                <Button
                  small
                  variant="ghost"
                  aria-label="Remove item"
                  onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}>
                  ✕
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button small onClick={() => addAfter(items.length - 1)}>
              + Add item
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
