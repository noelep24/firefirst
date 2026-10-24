import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { http, type Schemas } from '@/api/http';
import { useAuth } from '@/auth';
import { DepartmentEmblem } from '@/components/brand';
import { Button, Card, ErrorBox, PageHeader, QueryState, Tabs } from '@/components/ui';
import { shrinkImage } from '@/lib/image';

const timezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
];

export default function Settings() {
  const department = useQuery({
    queryKey: ['/api/v1/department/'],
    queryFn: () => http.get<Schemas['Department']>('/api/v1/department/'),
  });
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'overtime' ? 'overtime' : 'general';
  return (
    <div>
      <PageHeader title="Department settings" />
      <Tabs<'general' | 'overtime'>
        value={tab}
        onChange={(value) => setParams(value === 'general' ? {} : { tab: value }, { replace: true })}
        options={[
          { value: 'general', label: 'General' },
          { value: 'overtime', label: 'Overtime rules' },
        ]}
      />
      {tab === 'general' ? (
        <QueryState query={department}>{(d) => <SettingsForm department={d} />}</QueryState>
      ) : (
        <OvertimeRules />
      )}
    </div>
  );
}

type Rules = Schemas['OvertimeSettings'];

/** How the department fills overtime: every agency runs its list a little differently. */
function OvertimeRules() {
  const rules = useQuery({
    queryKey: ['/api/v1/overtime-settings/'],
    queryFn: () => http.get<Rules>('/api/v1/overtime-settings/'),
  });
  return <QueryState query={rules}>{(r) => <OvertimeRulesForm rules={r} />}</QueryState>;
}

function OvertimeRulesForm({ rules }: { rules: Rules }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(rules);
  const [saved, setSaved] = useState(false);
  const set = (change: Partial<Rules>) => {
    setSaved(false);
    setValues({ ...values, ...change });
  };
  const save = useMutation({
    mutationFn: () => http.patch<Rules>('/api/v1/overtime-settings/', values),
    onSuccess: (data) => {
      setSaved(true);
      queryClient.setQueryData(['/api/v1/overtime-settings/'], data);
    },
  });

  return (
    <Card className="card-narrow">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}>
        <p className="muted">
          When a seat needs overtime, FireFirst offers it to members off duty on the right list (captains & engineers,
          or firefighters & medics), then hires whoever is highest on the list.
        </p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.voluntary_first}
            onChange={(e) => set({ voluntary_first: e.target.checked })}
          />
          Offer overtime to volunteers before forcing anyone
        </label>
        <span className="field-help">
          {values.voluntary_first
            ? 'Everyone available is asked first. If no one volunteers, the next member up is hired as mandatory.'
            : 'The next member up on the list is hired as mandatory right away.'}
        </span>
        <div className="field">
          <label htmlFor="ot-hours">Time to answer an offer (hours)</label>
          <input
            id="ot-hours"
            type="number"
            min={1}
            max={72}
            value={values.response_hours}
            disabled={!values.voluntary_first}
            onChange={(e) => set({ response_hours: Number(e.target.value) })}
            style={{ maxWidth: 140 }}
          />
          <span className="field-help">
            When time is up, the volunteer highest on the list is hired. Anyone who hasn't answered counts as a no.
          </span>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.refusal_moves_to_bottom}
            onChange={(e) => set({ refusal_moves_to_bottom: e.target.checked })}
          />
          Turning down an offer sends the member to the bottom of the list
        </label>
        <span className="field-help">
          {values.refusal_moves_to_bottom
            ? 'A refusal counts like working the shift.'
            : 'Members keep their place when they turn an offer down.'}
        </span>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.vacancy_from_leave}
            onChange={(e) => set({ vacancy_from_leave: e.target.checked })}
          />
          Open a vacancy automatically when leave is approved
        </label>
        <span className="field-help">
          Each shift the member would have worked becomes a vacancy, filled by the rules above.
        </span>
        <ErrorBox error={save.error} />
        {saved ? <div className="notice">Saved.</div> : null}
        <div>
          <Button variant="primary" type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SettingsForm({ department }: { department: Schemas['Department'] }) {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  const [name, setName] = useState(department.name);
  const [timezone, setTimezone] = useState(department.timezone ?? 'America/Chicago');
  const [nerisId, setNerisId] = useState(department.neris_id ?? '');
  // The image to show: the saved one's URL, a newly picked image, or '' once removed. Only a change is sent.
  const [logo, setLogo] = useState(department.logo_url ?? '');
  const logoChanged = logo !== (department.logo_url ?? '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      http.patch<Schemas['Department']>('/api/v1/department/', {
        name,
        timezone,
        neris_id: nerisId,
        ...(logoChanged ? { logo } : {}),
      }),
    onSuccess: async () => {
      setSaved(true);
      queryClient.invalidateQueries();
      await refreshMe();
    },
  });

  const zones = timezones.includes(timezone) ? timezones : [timezone, ...timezones];
  return (
    <Card className="card-narrow">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate();
        }}>
        <div className="field">
          <label htmlFor="dept-name">Department name</label>
          <input id="dept-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <span className="field-label">Patch or logo</span>
          <div className="logo-picker">
            <DepartmentEmblem logo={logo} name={name} size={96} />
            <div className="stack-sm">
              <div className="row">
                <label className="btn btn-secondary btn-sm">
                  <ImageUp size={16} aria-hidden="true" />
                  {logo ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*"
                    className="visually-hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setLogoError(null);
                      setSaved(false);
                      try {
                        setLogo(await shrinkImage(file));
                      } catch {
                        setLogoError("That file couldn't be opened as an image.");
                      }
                    }}
                  />
                </label>
                {logo ? (
                  <Button small variant="ghost" onClick={() => setLogo('')}>
                    <Trash2 size={16} aria-hidden="true" />
                    Remove
                  </Button>
                ) : null}
              </div>
              <span className="field-help">
                Shown on the home page and in the menu. A square image with a transparent background looks best.
              </span>
              {logoError ? <span className="field-error">{logoError}</span> : null}
            </div>
          </div>
        </div>
        <div className="field">
          <label htmlFor="dept-tz">Time zone</label>
          <select id="dept-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dept-neris">NERIS ID</label>
          <input
            id="dept-neris"
            value={nerisId}
            onChange={(e) => setNerisId(e.target.value)}
            placeholder="FD12345678"
            maxLength={10}
          />
          <span className="field-help">
            Your department's NERIS ID. It goes on every incident report exported to NERIS.
          </span>
        </div>
        <div className="field">
          <span className="field-label">Account ID</span>
          <code>{department.slug}</code>
        </div>
        <ErrorBox error={save.error} />
        {saved ? <div className="notice">Saved.</div> : null}
        <div>
          <Button variant="primary" type="submit" loading={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
