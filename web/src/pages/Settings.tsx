import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { http, type Schemas } from '@/api/http';
import { useAuth } from '@/auth';
import { Button, Card, ErrorBox, PageHeader, QueryState } from '@/components/ui';

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
  return (
    <div>
      <PageHeader title="Department settings" />
      <QueryState query={department}>{(d) => <SettingsForm department={d} />}</QueryState>
    </div>
  );
}

function SettingsForm({ department }: { department: Schemas['Department'] }) {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  const [name, setName] = useState(department.name);
  const [timezone, setTimezone] = useState(department.timezone ?? 'America/Chicago');
  const [nerisId, setNerisId] = useState(department.neris_id ?? '');
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => http.patch<Schemas['Department']>('/api/v1/department/', { name, timezone, neris_id: nerisId }),
    onSuccess: async () => {
      setSaved(true);
      queryClient.invalidateQueries();
      await refreshMe();
    },
  });

  const zones = timezones.includes(timezone) ? timezones : [timezone, ...timezones];
  return (
    <Card>
      <form
        className="stack"
        style={{ maxWidth: 520 }}
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
