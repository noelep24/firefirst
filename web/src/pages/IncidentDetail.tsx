import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { getAll, http, type Schemas } from '@/api/http';
import { useMe } from '@/auth';
import { toLocalInput } from '@/components/form';
import { Badge, Button, Card, ErrorBox, PageHeader, QueryState } from '@/components/ui';
import {
  grouped,
  isFire,
  isMedical,
  isOutsideFire,
  isStructureFire,
  labelOf,
  type NerisValue,
  useValueSets,
  type ValueSets,
} from '@/lib/neris';

type Incident = Schemas['Incident'];
type Unit = Schemas['IncidentUnit'];
type Patient = { eso_report?: string; care?: string; status?: string; disposition?: string };
type Fire = Record<string, string | string[] | number | undefined>;

/** The editable part of a report, held locally until saved. */
type Draft = Pick<
  Incident,
  | 'alarm_at'
  | 'address'
  | 'address_detail'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'incident_types'
  | 'actions_taken'
  | 'no_action_reason'
  | 'people_present'
  | 'displaced'
  | 'rescues_or_casualties'
  | 'narrative'
> & { fire: Fire; alarms: Record<string, string>; patients: Patient[]; station: number | null };

function toDraft(i: Incident): Draft {
  return {
    alarm_at: i.alarm_at,
    station: i.station ?? null,
    address: i.address ?? '',
    address_detail: i.address_detail ?? '',
    city: i.city ?? '',
    state: i.state ?? '',
    postal_code: i.postal_code ?? '',
    incident_types: (i.incident_types as string[]) ?? [],
    actions_taken: (i.actions_taken as string[]) ?? [],
    no_action_reason: i.no_action_reason ?? '',
    people_present: i.people_present ?? null,
    displaced: i.displaced ?? null,
    rescues_or_casualties: i.rescues_or_casualties ?? null,
    narrative: i.narrative ?? '',
    fire: (i.fire as Fire) ?? {},
    alarms: (i.alarms as Record<string, string>) ?? {},
    patients: (i.patients as Patient[]) ?? [],
  };
}

export default function IncidentDetail() {
  const id = Number(useParams().id);
  const incident = useQuery({
    queryKey: ['/api/v1/incidents/', id],
    queryFn: () => http.get<Incident>(`/api/v1/incidents/${id}/`),
  });
  const sets = useValueSets();
  return (
    <QueryState query={incident}>
      {(i) => (
        <QueryState query={sets}>{(v) => <Report key={`${i.id}-${i.status}`} incident={i} sets={v} />}</QueryState>
      )}
    </QueryState>
  );
}

function Report({ incident, sets }: { incident: Incident; sets: ValueSets }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { me } = useMe();
  const isOfficer = me.role === 'admin' || me.role === 'officer';
  const locked = incident.status === 'complete' && !isOfficer;
  const [draft, setDraft] = useState<Draft>(() => toDraft(incident));
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const refresh = (data?: Incident) => {
    if (data) queryClient.setQueryData(['/api/v1/incidents/', incident.id], data);
    queryClient.invalidateQueries({ queryKey: ['/api/v1/incidents/'] });
  };

  const save = useMutation({
    mutationFn: () => http.patch<Incident>(`/api/v1/incidents/${incident.id}/`, draft),
    onSuccess: (data) => {
      setDirty(false);
      refresh(data);
    },
  });
  const complete = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await http.patch<Incident>(`/api/v1/incidents/${incident.id}/`, draft);
        setDirty(false);
      }
      return http.post<Incident>(`/api/v1/incidents/${incident.id}/complete/`);
    },
    onSuccess: (data) => refresh(data),
    // Refresh even on failure: the save went through and the checklist should show what's left.
    onError: () => queryClient.invalidateQueries({ queryKey: ['/api/v1/incidents/', incident.id] }),
  });
  const reopen = useMutation({
    mutationFn: () => http.post<Incident>(`/api/v1/incidents/${incident.id}/reopen/`),
    onSuccess: (data) => refresh(data),
  });
  const remove = useMutation({
    mutationFn: () => http.delete(`/api/v1/incidents/${incident.id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/v1/incidents/'] });
      navigate('/incidents');
    },
  });
  const exportNeris = async () => {
    const body = await http.get<unknown>(`/api/v1/incidents/${incident.id}/neris/`);
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `neris-${incident.number}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const types = draft.incident_types as string[];
  const fire = draft.fire;
  const setFire = (key: string, value: Fire[string]) => set('fire', { ...fire, [key]: value });

  return (
    <div className="stack">
      <PageHeader
        title={`Incident ${incident.number}`}
        subtitle={
          <span className="row">
            {incident.status === 'complete' ? (
              <Badge tone="success">Complete</Badge>
            ) : (
              <Badge tone="warning">Draft</Badge>
            )}
            <span>{incident.created_by_name ? `Started by ${incident.created_by_name}` : ''}</span>
          </span>
        }
        actions={
          <>
            <Link to="/incidents" className="btn btn-ghost">
              All incidents
            </Link>
            <Button onClick={exportNeris}>NERIS export</Button>
            {!locked ? (
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
                {dirty ? 'Save' : 'Saved'}
              </Button>
            ) : null}
          </>
        }
      />
      {locked ? <div className="notice">This report is complete. An officer can reopen it for changes.</div> : null}
      <ErrorBox error={save.error} />

      <div className="incident-layout">
        <fieldset className="stack incident-form" disabled={locked}>
          <Section title="Call">
            <div className="form-grid">
              <Field label="Alarm time">
                <input
                  type="datetime-local"
                  value={toLocalInput(draft.alarm_at)}
                  onChange={(e) => e.target.value && set('alarm_at', new Date(e.target.value).toISOString())}
                />
              </Field>
              <StationSelect value={draft.station} onChange={(v) => set('station', v)} />
            </div>
            <TypePicker options={sets.incident_type} value={types} onChange={(v) => set('incident_types', v)} />
          </Section>

          <Section title="Location">
            <div className="form-grid">
              <Field label="Street address" wide>
                <input
                  value={draft.address}
                  onChange={(e) => set('address', e.target.value)}
                  placeholder="120 N Oak Ave"
                />
              </Field>
              <Field label="Apartment, floor or landmark">
                <input value={draft.address_detail} onChange={(e) => set('address_detail', e.target.value)} />
              </Field>
              <Field label="City">
                <input value={draft.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="State">
                <input
                  value={draft.state}
                  maxLength={2}
                  placeholder="TX"
                  onChange={(e) => set('state', e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="ZIP">
                <input value={draft.postal_code} onChange={(e) => set('postal_code', e.target.value)} />
              </Field>
            </div>
          </Section>

          <Units incident={incident} sets={sets} locked={locked} onChanged={() => refresh()} />

          <Section title="On scene">
            <div className="form-grid">
              <YesNo
                label="Were people present?"
                value={draft.people_present}
                onChange={(v) => set('people_present', v)}
              />
              <YesNo
                label="Any rescues or casualties?"
                value={draft.rescues_or_casualties}
                onChange={(v) => set('rescues_or_casualties', v)}
              />
              <Field label="People displaced">
                <input
                  type="number"
                  min={0}
                  value={draft.displaced ?? ''}
                  onChange={(e) => set('displaced', e.target.value === '' ? null : Number(e.target.value))}
                />
              </Field>
            </div>
            {draft.rescues_or_casualties ? (
              <p className="muted small">
                Rescue and casualty details aren't in FireFirst yet. Add them in NERIS when you submit this report.
              </p>
            ) : null}
            <MultiPicker
              label="Actions taken"
              options={sets.action}
              value={draft.actions_taken as string[]}
              onChange={(v) => set('actions_taken', v)}
              disabled={!!draft.no_action_reason}
            />
            {(draft.actions_taken as string[]).length === 0 ? (
              <Field label="Or, why no action was taken">
                <CodeSelect
                  options={sets.no_action}
                  value={draft.no_action_reason ?? ''}
                  onChange={(v) => set('no_action_reason', v)}
                />
              </Field>
            ) : null}
          </Section>

          {isFire(types) ? (
            <Section title="Fire">
              <MultiPicker
                label="Suppression used"
                options={sets.suppression_appliance}
                value={(fire.suppression_appliances as string[]) ?? []}
                onChange={(v) => setFire('suppression_appliances', v)}
              />
              <div className="form-grid">
                <Field label="Water supply">
                  <CodeSelect
                    options={sets.water_supply}
                    value={(fire.water_supply as string) ?? ''}
                    onChange={(v) => setFire('water_supply', v)}
                  />
                </Field>
                <Field label="Investigation needed?">
                  <CodeSelect
                    options={sets.investigation_need}
                    value={(fire.investigation_need as string) ?? ''}
                    onChange={(v) => setFire('investigation_need', v)}
                  />
                </Field>
              </div>
              {fire.investigation_need === 'YES' ? (
                <MultiPicker
                  label="Investigation type"
                  options={sets.investigation_type}
                  value={(fire.investigation_types as string[]) ?? []}
                  onChange={(v) => setFire('investigation_types', v)}
                />
              ) : null}
              {isStructureFire(types) ? (
                <>
                  <h3>Structure</h3>
                  <div className="form-grid">
                    <Field label="Conditions on arrival">
                      <CodeSelect
                        options={sets.arrival_conditions}
                        value={(fire.arrival_conditions as string) ?? ''}
                        onChange={(v) => setFire('arrival_conditions', v)}
                      />
                    </Field>
                    <Field label="Building damage">
                      <CodeSelect
                        options={sets.building_damage}
                        value={(fire.building_damage as string) ?? ''}
                        onChange={(v) => setFire('building_damage', v)}
                      />
                    </Field>
                    <Field label="Floor of origin">
                      <input
                        type="number"
                        value={(fire.floor_of_origin as number | undefined) ?? ''}
                        onChange={(e) =>
                          setFire('floor_of_origin', e.target.value === '' ? undefined : Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Room of origin">
                      <CodeSelect
                        options={sets.room}
                        value={(fire.room_of_origin as string) ?? ''}
                        onChange={(v) => setFire('room_of_origin', v)}
                      />
                    </Field>
                    <Field label="Cause">
                      <CodeSelect
                        options={sets.structure_cause}
                        value={(fire.structure_cause as string) ?? ''}
                        onChange={(v) => setFire('structure_cause', v)}
                      />
                    </Field>
                  </div>
                  <div className="form-grid">
                    {(
                      [
                        ['smoke_alarm', 'Smoke alarms'],
                        ['fire_alarm', 'Fire alarm system'],
                        ['sprinklers', 'Sprinklers'],
                      ] as const
                    ).map(([key, text]) => (
                      <Field key={key} label={text}>
                        <CodeSelect
                          options={sets.presence}
                          value={draft.alarms[key] ?? ''}
                          onChange={(v) => set('alarms', { ...draft.alarms, [key]: v })}
                        />
                      </Field>
                    ))}
                  </div>
                </>
              ) : null}
              {isOutsideFire(types) ? (
                <div className="form-grid">
                  <Field label="Outside fire cause">
                    <CodeSelect
                      options={sets.outside_cause}
                      value={(fire.outside_cause as string) ?? ''}
                      onChange={(v) => setFire('outside_cause', v)}
                    />
                  </Field>
                  <Field label="Acres burned">
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={(fire.acres_burned as number | undefined) ?? ''}
                      onChange={(e) =>
                        setFire('acres_burned', e.target.value === '' ? undefined : Number(e.target.value))
                      }
                    />
                  </Field>
                </div>
              ) : null}
            </Section>
          ) : null}

          {isMedical(types) ? (
            <Section title="Patients">
              <p className="muted small">
                Patient care is documented in ESO. Record each patient's ESO report number here, with no other patient
                details.
              </p>
              {draft.patients.map((p, n) => {
                const update = (patch: Patient) =>
                  set(
                    'patients',
                    draft.patients.map((x, m) => (m === n ? { ...x, ...patch } : x)),
                  );
                return (
                  <Card key={n} className="stack-sm">
                    <div className="row spread">
                      <strong>Patient {n + 1}</strong>
                      <Button
                        small
                        variant="ghost"
                        onClick={() =>
                          set(
                            'patients',
                            draft.patients.filter((_, m) => m !== n),
                          )
                        }>
                        Remove
                      </Button>
                    </div>
                    <div className="form-grid">
                      <Field label="ESO report number">
                        <input value={p.eso_report ?? ''} onChange={(e) => update({ eso_report: e.target.value })} />
                      </Field>
                      <Field label="Evaluation and care">
                        <CodeSelect
                          options={sets.patient_care}
                          value={p.care ?? ''}
                          onChange={(v) => update({ care: v })}
                        />
                      </Field>
                      <Field label="Condition">
                        <CodeSelect
                          options={sets.patient_status}
                          value={p.status ?? ''}
                          onChange={(v) => update({ status: v })}
                        />
                      </Field>
                      <Field label="Transport">
                        <CodeSelect
                          options={sets.medical_disposition}
                          value={p.disposition ?? ''}
                          onChange={(v) => update({ disposition: v })}
                        />
                      </Field>
                    </div>
                  </Card>
                );
              })}
              <div>
                <Button small onClick={() => set('patients', [...draft.patients, {}])}>
                  Add patient
                </Button>
              </div>
            </Section>
          ) : null}

          <Section title="Narrative">
            <textarea
              aria-label="Narrative"
              rows={6}
              value={draft.narrative}
              onChange={(e) => set('narrative', e.target.value)}
              placeholder="What happened, what you did, and the outcome."
            />
          </Section>
        </fieldset>

        <aside className="incident-side">
          <Card className="stack-sm">
            <h3>Ready for NERIS?</h3>
            {incident.missing.length === 0 ? (
              <span className="tone-success">
                <strong>Everything NERIS needs is here.</strong>
              </span>
            ) : (
              <ul className="checklist">
                {incident.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
            {dirty ? <span className="muted small">Save to update this list.</span> : null}
            {incident.status === 'draft' ? (
              <Button
                variant="primary"
                disabled={incident.missing.length > 0 && !dirty}
                loading={complete.isPending}
                onClick={() => complete.mutate()}>
                Mark complete
              </Button>
            ) : isOfficer ? (
              <Button loading={reopen.isPending} onClick={() => reopen.mutate()}>
                Reopen
              </Button>
            ) : null}
            <ErrorBox error={complete.error ?? reopen.error} />
            {isOfficer ? (
              <Button
                variant="danger"
                small
                onClick={() => window.confirm(`Delete incident ${incident.number}?`) && remove.mutate()}>
                Delete report
              </Button>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="stack">
      <h2>{title}</h2>
      {children}
    </Card>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'span-all' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function YesNo({ label, value, onChange }: { label: string; value?: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="row">
        <Button small variant={value === true ? 'primary' : 'secondary'} onClick={() => onChange(true)}>
          Yes
        </Button>
        <Button small variant={value === false ? 'primary' : 'secondary'} onClick={() => onChange(false)}>
          No
        </Button>
      </div>
    </div>
  );
}

function CodeSelect({
  options,
  value,
  onChange,
}: {
  options: NerisValue[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A grouped dropdown for hierarchical NERIS codes. */
function GroupedSelect({
  options,
  value,
  onChange,
  placeholder,
  exclude = [],
}: {
  options: NerisValue[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  exclude?: string[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {grouped(options.filter((o) => o.value === value || !exclude.includes(o.value))).map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function TypePicker({
  options,
  value,
  onChange,
}: {
  options: NerisValue[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const slots = [...value, ''].slice(0, 3);
  return (
    <div className="form-grid">
      {slots.map((code, n) => (
        <Field key={n} label={n === 0 ? 'Incident type' : `Additional type ${n}`}>
          <GroupedSelect
            options={options}
            value={code}
            exclude={value}
            placeholder={n === 0 ? 'Choose the main incident type' : 'Optional'}
            onChange={(v) => {
              const next = [...value];
              if (v) next[n] = v;
              else next.splice(n, 1);
              onChange(next.filter(Boolean));
            }}
          />
        </Field>
      ))}
    </div>
  );
}

/** Pick several codes: a dropdown adds one, chips remove them. */
function MultiPicker({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: NerisValue[];
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const hierarchical = options.some((o) => o.label.includes(' › '));
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {value.length ? (
        <div className="row">
          {value.map((code) => (
            <button key={code} type="button" className="chip" onClick={() => onChange(value.filter((c) => c !== code))}>
              {labelOf(options, code)} <span aria-hidden>✕</span>
            </button>
          ))}
        </div>
      ) : null}
      {hierarchical ? (
        <GroupedSelect
          options={options}
          value=""
          exclude={value}
          placeholder={disabled ? 'No action taken' : 'Add…'}
          onChange={(v) => v && onChange([...value, v])}
        />
      ) : (
        <select value="" disabled={disabled} onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
          <option value="">Add…</option>
          {options
            .filter((o) => !value.includes(o.value))
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}

function StationSelect({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const stations = useQuery({
    queryKey: ['/api/v1/stations/'],
    queryFn: () => getAll<Schemas['Station']>('/api/v1/stations/'),
  });
  return (
    <Field label="First-due station">
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">—</option>
        {(stations.data ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            Station {s.number}
            {s.name ? ` – ${s.name}` : ''}
          </option>
        ))}
      </select>
    </Field>
  );
}

const TIMES: [keyof Unit, string][] = [
  ['dispatched_at', 'Dispatched'],
  ['enroute_at', 'En route'],
  ['on_scene_at', 'On scene'],
  ['cancelled_at', 'Cancelled'],
  ['cleared_at', 'Cleared'],
];

/** Units on the call. Adding a rig brings the crew riding it that day. */
function Units({
  incident,
  sets,
  locked,
  onChanged,
}: {
  incident: Incident;
  sets: ValueSets;
  locked: boolean;
  onChanged: () => void;
}) {
  const rigs = useQuery({
    queryKey: ['/api/v1/apparatus/'],
    queryFn: () => getAll<Schemas['Apparatus']>('/api/v1/apparatus/'),
  });
  const [other, setOther] = useState('');
  const add = useMutation({
    mutationFn: (body: { apparatus?: number; unit?: string }) =>
      http.post<Unit>('/api/v1/incident-units/', {
        incident: incident.id,
        dispatched_at: incident.alarm_at,
        response_mode: 'EMERGENT',
        ...body,
      }),
    onSuccess: () => {
      setOther('');
      onChanged();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: Partial<Unit> & { id: number }) =>
      http.patch<Unit>(`/api/v1/incident-units/${id}/`, body),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: (id: number) => http.delete(`/api/v1/incident-units/${id}/`),
    onSuccess: onChanged,
  });
  const onCall = new Set(incident.units.map((u) => u.apparatus));

  return (
    <Section title="Units">
      {incident.units.length === 0 ? <p className="muted">Add the units that responded.</p> : null}
      {incident.units.map((u) => (
        <Card key={u.id} className="stack-sm unit-card">
          <div className="row spread">
            <span className="row">
              <strong className="rig-unit">{u.unit}</strong>
              <span className="muted small">
                {u.crew_names.length ? u.crew_names.join(', ') : 'No crew listed'}
                {u.staffing ? ` · ${u.staffing} staff` : ''}
              </span>
            </span>
            {!locked ? (
              <Button small variant="ghost" onClick={() => remove.mutate(u.id)}>
                Remove
              </Button>
            ) : null}
          </div>
          <div className="unit-times">
            <label className="field">
              <span className="field-label">Response</span>
              <select
                value={u.response_mode ?? ''}
                onChange={(e) => update.mutate({ id: u.id, response_mode: e.target.value })}>
                <option value="">—</option>
                {sets.response_mode.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            {TIMES.map(([key, text]) => (
              <label key={key} className="field">
                <span className="field-label">{text}</span>
                <input
                  type="datetime-local"
                  defaultValue={toLocalInput(u[key] as string | null)}
                  onBlur={(e) => {
                    const iso = e.target.value ? new Date(e.target.value).toISOString() : null;
                    if (iso !== (u[key] ?? null)) update.mutate({ id: u.id, [key]: iso });
                  }}
                />
              </label>
            ))}
            <label className="field">
              <span className="field-label">Staffing</span>
              <input
                type="number"
                min={0}
                defaultValue={u.staffing ?? ''}
                onBlur={(e) => {
                  const n = e.target.value === '' ? null : Number(e.target.value);
                  if (n !== (u.staffing ?? null)) update.mutate({ id: u.id, staffing: n });
                }}
              />
            </label>
          </div>
        </Card>
      ))}
      {!locked ? (
        <div className="row">
          {(rigs.data ?? [])
            .filter((r) => !onCall.has(r.id))
            .map((r) => (
              <Button
                key={r.id}
                small
                loading={add.isPending && add.variables?.apparatus === r.id}
                onClick={() => add.mutate({ apparatus: r.id })}>
                + {r.unit_number}
              </Button>
            ))}
          <input
            aria-label="Other unit"
            placeholder="Mutual aid unit, e.g. M12"
            value={other}
            style={{ maxWidth: 240 }}
            onChange={(e) => setOther(e.target.value)}
          />
          <Button small disabled={!other.trim()} onClick={() => add.mutate({ unit: other.trim() })}>
            Add unit
          </Button>
        </div>
      ) : null}
      <ErrorBox error={add.error ?? update.error ?? remove.error} />
    </Section>
  );
}
