import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, type Schemas, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { CodePicker, type CodeOption } from '@/components/code-picker';
import { Badge, Button, Card, ErrorBox, Field, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime, formatTime } from '@/lib/format';
import { isFire, isMedical, isOutsideFire, isStructureFire, useValueSets } from '@/lib/neris';
import { rigsQuery } from '@/lib/queries';

type Incident = Schemas['Incident'];
type Sets = Schemas['NerisValueSets'];
type Patient = { eso_report?: string; care?: string; status?: string; disposition?: string };
type Fire = Record<string, string | string[] | number | undefined>;
type Draft = {
  address: string;
  address_detail: string;
  city: string;
  state: string;
  incident_types: string[];
  actions_taken: string[];
  no_action_reason: string;
  people_present: boolean | null;
  rescues_or_casualties: boolean | null;
  fire: Fire;
  alarms: Record<string, string>;
  patients: Patient[];
  narrative: string;
};

const toDraft = (i: Incident): Draft => ({
  address: i.address ?? '',
  address_detail: i.address_detail ?? '',
  city: i.city ?? '',
  state: i.state ?? '',
  incident_types: (i.incident_types as string[]) ?? [],
  actions_taken: (i.actions_taken as string[]) ?? [],
  no_action_reason: i.no_action_reason ?? '',
  people_present: i.people_present ?? null,
  rescues_or_casualties: i.rescues_or_casualties ?? null,
  fire: (i.fire as Fire) ?? {},
  alarms: (i.alarms as Record<string, string>) ?? {},
  patients: (i.patients as Patient[]) ?? [],
  narrative: i.narrative ?? '',
});

export default function IncidentScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const incident = useQuery({
    queryKey: ['incidents', id],
    queryFn: () => unwrap(api().GET('/api/v1/incidents/{id}/', { params: { path: { id } } })),
  });
  const sets = useValueSets();
  return (
    <Screen refreshing={incident.isRefetching} onRefresh={incident.refetch}>
      <Stack.Screen options={{ title: incident.data ? `Incident ${incident.data.number}` : 'Incident' }} />
      <QueryState query={sets}>
        {(setsData) => (
          <QueryState query={incident}>
            {(data) => <Report key={`${data.id}-${data.status}`} incident={data} sets={setsData} />}
          </QueryState>
        )}
      </QueryState>
    </Screen>
  );
}

function Report({ incident, sets }: { incident: Incident; sets: Sets }) {
  const queryClient = useQueryClient();
  const { isOfficer } = useMe();
  const locked = incident.status === 'complete' && !isOfficer;
  const [draft, setDraft] = useState<Draft>(() => toDraft(incident));
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };
  const saved = (data?: Incident) => {
    if (data) queryClient.setQueryData(['incidents', incident.id], data);
    queryClient.invalidateQueries({ queryKey: ['incidents'] });
  };
  const patch = () =>
    unwrap(api().PATCH('/api/v1/incidents/{id}/', { params: { path: { id: incident.id } }, body: draft }));

  const save = useMutation({
    mutationFn: patch,
    onSuccess: (data) => {
      setDirty(false);
      saved(data);
    },
  });
  const complete = useMutation({
    mutationFn: async () => {
      if (dirty) {
        await patch();
        setDirty(false);
      }
      return unwrap(api().POST('/api/v1/incidents/{id}/complete/', { params: { path: { id: incident.id } } }));
    },
    onSuccess: (data) => saved(data),
    onError: () => saved(),
  });

  const types = draft.incident_types;
  const fire = draft.fire;
  const setFire = (key: string, value: Fire[string]) => set('fire', { ...fire, [key]: value });
  const code = (key: string) => (fire[key] as string | undefined) ?? '';

  return (
    <>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label type="smallBold" color="textSecondary">
            {formatDateTime(incident.alarm_at)}
          </Label>
          {incident.status === 'complete' ? (
            <Badge text="Complete" tone="success" />
          ) : (
            <Badge text="Draft" tone="warning" />
          )}
        </Row>
        {incident.missing.length ? (
          <>
            <Label type="smallBold">Still needed for NERIS</Label>
            {incident.missing.map((m) => (
              <Label key={m} type="small" color="textSecondary">
                • {m}
              </Label>
            ))}
          </>
        ) : (
          <Label color="success">Everything NERIS needs is here.</Label>
        )}
        {dirty ? (
          <Label type="small" color="textSecondary">
            Save to update this list.
          </Label>
        ) : null}
      </Card>
      {locked ? (
        <Label color="textSecondary">This report is complete. An officer can reopen it for changes.</Label>
      ) : null}

      <View pointerEvents={locked ? 'none' : 'auto'} style={[styles.form, locked && styles.locked]}>
        <Section title="Call">
          {[0, 1, 2].slice(0, Math.min(types.length + 1, 3)).map((n) => (
            <CodePicker
              key={n}
              label={n === 0 ? 'Incident type' : `Additional type ${n}`}
              options={sets.incident_type}
              value={types[n] ?? ''}
              exclude={types.filter((_, m) => m !== n)}
              placeholder={n === 0 ? 'Search, e.g. kitchen, cardiac, alarm' : 'Optional'}
              onChange={(v) => {
                const next = [...types];
                if (v) next[n] = v;
                else next.splice(n, 1);
                set('incident_types', next.filter(Boolean));
              }}
            />
          ))}
        </Section>

        <Section title="Location">
          <Field label="Street address" value={draft.address} onChangeText={(v) => set('address', v)} />
          <Field
            label="Apartment, floor or landmark"
            value={draft.address_detail}
            onChangeText={(v) => set('address_detail', v)}
          />
          <Row style={{ flexWrap: 'nowrap' }}>
            <View style={styles.flex}>
              <Field label="City" value={draft.city} onChangeText={(v) => set('city', v)} />
            </View>
            <View style={styles.state}>
              <Field
                label="State"
                value={draft.state}
                autoCapitalize="characters"
                maxLength={2}
                onChangeText={(v) => set('state', v.toUpperCase())}
              />
            </View>
          </Row>
        </Section>

        <Units incident={incident} sets={sets} onChanged={() => saved()} />

        <Section title="On scene">
          <YesNo label="Were people present?" value={draft.people_present} onChange={(v) => set('people_present', v)} />
          <YesNo
            label="Any rescues or casualties?"
            value={draft.rescues_or_casualties}
            onChange={(v) => set('rescues_or_casualties', v)}
          />
          {draft.rescues_or_casualties ? (
            <Label type="small" color="textSecondary">
              Add rescue and casualty details in NERIS when the report is submitted.
            </Label>
          ) : null}
          <MultiCodes
            label="Actions taken"
            options={sets.action}
            value={draft.actions_taken}
            onChange={(v) => set('actions_taken', v)}
          />
          {draft.actions_taken.length === 0 ? (
            <CodePicker
              label="Or, why no action was taken"
              options={sets.no_action}
              value={draft.no_action_reason}
              onChange={(v) => set('no_action_reason', v)}
            />
          ) : null}
        </Section>

        {isFire(types) ? (
          <Section title="Fire">
            <MultiCodes
              label="Suppression used"
              options={sets.suppression_appliance}
              value={(fire.suppression_appliances as string[]) ?? []}
              onChange={(v) => setFire('suppression_appliances', v)}
            />
            <CodePicker
              label="Water supply"
              options={sets.water_supply}
              value={code('water_supply')}
              onChange={(v) => setFire('water_supply', v)}
            />
            <CodePicker
              label="Investigation needed?"
              options={sets.investigation_need}
              value={code('investigation_need')}
              onChange={(v) => setFire('investigation_need', v)}
            />
            {fire.investigation_need === 'YES' ? (
              <MultiCodes
                label="Investigation type"
                options={sets.investigation_type}
                value={(fire.investigation_types as string[]) ?? []}
                onChange={(v) => setFire('investigation_types', v)}
              />
            ) : null}
            {isStructureFire(types) ? (
              <>
                <CodePicker
                  label="Conditions on arrival"
                  options={sets.arrival_conditions}
                  value={code('arrival_conditions')}
                  onChange={(v) => setFire('arrival_conditions', v)}
                />
                <CodePicker
                  label="Building damage"
                  options={sets.building_damage}
                  value={code('building_damage')}
                  onChange={(v) => setFire('building_damage', v)}
                />
                <Field
                  label="Floor of origin"
                  keyboardType="number-pad"
                  value={fire.floor_of_origin === undefined ? '' : String(fire.floor_of_origin)}
                  onChangeText={(v) => setFire('floor_of_origin', v === '' ? undefined : Number(v.replace(/\D/g, '')))}
                />
                <CodePicker
                  label="Room of origin"
                  options={sets.room}
                  value={code('room_of_origin')}
                  onChange={(v) => setFire('room_of_origin', v)}
                />
                <CodePicker
                  label="Cause"
                  options={sets.structure_cause}
                  value={code('structure_cause')}
                  onChange={(v) => setFire('structure_cause', v)}
                />
                {(
                  [
                    ['smoke_alarm', 'Smoke alarms'],
                    ['fire_alarm', 'Fire alarm system'],
                    ['sprinklers', 'Sprinklers'],
                  ] as const
                ).map(([key, text]) => (
                  <CodePicker
                    key={key}
                    label={text}
                    options={sets.presence}
                    value={draft.alarms[key] ?? ''}
                    onChange={(v) => set('alarms', { ...draft.alarms, [key]: v })}
                  />
                ))}
              </>
            ) : null}
            {isOutsideFire(types) ? (
              <>
                <CodePicker
                  label="Outside fire cause"
                  options={sets.outside_cause}
                  value={code('outside_cause')}
                  onChange={(v) => setFire('outside_cause', v)}
                />
                <Field
                  label="Acres burned"
                  keyboardType="decimal-pad"
                  value={fire.acres_burned === undefined ? '' : String(fire.acres_burned)}
                  onChangeText={(v) => setFire('acres_burned', v === '' || isNaN(Number(v)) ? undefined : Number(v))}
                />
              </>
            ) : null}
          </Section>
        ) : null}

        {isMedical(types) ? (
          <Section title="Patients">
            <Label type="small" color="textSecondary">
              {"Care is documented in ESO. Add each patient's ESO report number here, with no other patient details."}
            </Label>
            {draft.patients.map((p, n) => {
              const update = (change: Patient) =>
                set(
                  'patients',
                  draft.patients.map((x, m) => (m === n ? { ...x, ...change } : x)),
                );
              return (
                <Card key={n}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="smallBold">Patient {n + 1}</Label>
                    <Button
                      title="Remove"
                      variant="ghost"
                      small
                      onPress={() =>
                        set(
                          'patients',
                          draft.patients.filter((_, m) => m !== n),
                        )
                      }
                    />
                  </Row>
                  <Field
                    label="ESO report number"
                    value={p.eso_report ?? ''}
                    autoCapitalize="none"
                    onChangeText={(v) => update({ eso_report: v })}
                  />
                  <CodePicker
                    label="Evaluation and care"
                    options={sets.patient_care}
                    value={p.care ?? ''}
                    onChange={(v) => update({ care: v })}
                  />
                  <CodePicker
                    label="Condition"
                    options={sets.patient_status}
                    value={p.status ?? ''}
                    onChange={(v) => update({ status: v })}
                  />
                  <CodePicker
                    label="Transport"
                    options={sets.medical_disposition}
                    value={p.disposition ?? ''}
                    onChange={(v) => update({ disposition: v })}
                  />
                </Card>
              );
            })}
            <Button
              title="Add patient"
              variant="secondary"
              small
              onPress={() => set('patients', [...draft.patients, {}])}
            />
          </Section>
        ) : null}

        <Section title="Narrative">
          <Field
            label="What happened, what you did, and the outcome"
            value={draft.narrative}
            onChangeText={(v) => set('narrative', v)}
            multiline
            style={styles.narrative}
          />
        </Section>
      </View>

      {(save.error ?? complete.error) ? <ErrorBox error={save.error ?? complete.error} /> : null}
      {!locked ? (
        <>
          <Button
            title={dirty ? 'Save' : 'Saved'}
            variant="secondary"
            disabled={!dirty}
            loading={save.isPending}
            onPress={() => save.mutate()}
          />
          {incident.status === 'draft' ? (
            <Button
              title="Mark complete"
              disabled={incident.missing.length > 0 && !dirty}
              loading={complete.isPending}
              onPress={() => complete.mutate()}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Label style={styles.flex}>{label}</Label>
      <Button title="Yes" small variant={value === true ? 'primary' : 'secondary'} onPress={() => onChange(true)} />
      <Button title="No" small variant={value === false ? 'primary' : 'secondary'} onPress={() => onChange(false)} />
    </Row>
  );
}

/** Several codes: each choice is a removable chip, and a picker adds another. */
function MultiCodes({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: CodeOption[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.multi}>
      {value.length ? (
        <Row>
          {value.map((v) => (
            <Pressable
              key={v}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${v}`}
              onPress={() => onChange(value.filter((x) => x !== v))}
              style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
              <Label type="small">{(options.find((o) => o.value === v)?.label ?? v).split(' › ').at(-1)} ✕</Label>
            </Pressable>
          ))}
        </Row>
      ) : null}
      <CodePicker
        label={label}
        options={options}
        value=""
        exclude={value}
        placeholder={value.length ? 'Add another…' : 'Add…'}
        onChange={(v) => v && onChange([...value, v])}
      />
    </View>
  );
}

const STAMPS = [
  ['enroute_at', 'En route'],
  ['on_scene_at', 'On scene'],
  ['cleared_at', 'Cleared'],
] as const;

/** Units on the call: tap a rig to add it with its crew, and tap a time to stamp it now. */
function Units({ incident, sets, onChanged }: { incident: Incident; sets: Sets; onChanged: () => void }) {
  const rigs = useQuery(rigsQuery);
  const add = useMutation({
    mutationFn: (apparatus: number) =>
      unwrap(
        api().POST('/api/v1/incident-units/', {
          body: { incident: incident.id, apparatus, dispatched_at: incident.alarm_at, response_mode: 'EMERGENT' },
        }),
      ),
    onSuccess: onChanged,
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: Schemas['PatchedIncidentUnitRequest'] & { id: number }) =>
      unwrap(api().PATCH('/api/v1/incident-units/{id}/', { params: { path: { id } }, body })),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: (id: number) => unwrap(api().DELETE('/api/v1/incident-units/{id}/', { params: { path: { id } } })),
    onSuccess: onChanged,
  });
  const onCall = new Set(incident.units.map((u) => u.apparatus));

  return (
    <Section title="Units">
      {incident.units.map((u) => (
        <Card key={u.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label type="heading">{u.unit}</Label>
            <Button title="Remove" variant="ghost" small onPress={() => remove.mutate(u.id)} />
          </Row>
          <Label type="small" color="textSecondary">
            {u.crew_names.length ? u.crew_names.join(', ') : 'No crew listed'}
          </Label>
          <Row>
            {sets.response_mode.map((m) => (
              <Button
                key={m.value}
                title={m.label}
                small
                variant={u.response_mode === m.value ? 'primary' : 'secondary'}
                onPress={() => update.mutate({ id: u.id, response_mode: m.value })}
              />
            ))}
          </Row>
          <Row>
            {STAMPS.map(([key, text]) => (
              <Button
                key={key}
                small
                variant={u[key] ? 'secondary' : 'ghost'}
                title={u[key] ? `${text} ${formatTime(u[key]!)}` : `${text}: now`}
                onPress={() => update.mutate({ id: u.id, [key]: new Date().toISOString() })}
              />
            ))}
          </Row>
        </Card>
      ))}
      <QueryState query={rigs}>
        {(rigsData) => (
          <Row>
            {rigsData.results
              .filter((r) => !onCall.has(r.id))
              .map((r) => (
                <Button
                  key={r.id}
                  title={`+ ${r.unit_number}`}
                  small
                  variant="secondary"
                  loading={add.isPending && add.variables === r.id}
                  onPress={() => add.mutate(r.id)}
                />
              ))}
          </Row>
        )}
      </QueryState>
      {(add.error ?? update.error ?? remove.error) ? (
        <ErrorBox error={add.error ?? update.error ?? remove.error} />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { gap: Spacing.three },
  locked: { opacity: 0.7 },
  state: { width: 90 },
  multi: { gap: Spacing.two },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  narrative: { minHeight: 140, textAlignVertical: 'top', paddingTop: Spacing.two },
});
