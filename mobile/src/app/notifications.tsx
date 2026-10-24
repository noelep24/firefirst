import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Switch } from 'react-native';

import { api, unwrap, type Schemas } from '@/api/client';
import { Card, ErrorBox, Label, QueryState, Row, Screen } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

type Choice = Schemas['MyChannel'];

/** What reaches your phone and email. Changes save as you flip them. */
export default function MyNotificationsScreen() {
  const queryClient = useQueryClient();
  const mine = useQuery({
    queryKey: ['my-notifications'],
    queryFn: () => unwrap(api().GET('/api/v1/me/notifications/')),
  });
  const save = useMutation({
    mutationFn: (rows: Choice[]) =>
      unwrap(
        api().PATCH('/api/v1/me/notifications/', {
          body: rows.map(({ kind, push, email }) => ({ kind, push, email })) as Choice[],
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(['my-notifications'], data),
  });

  return (
    <Screen subtitle="Choose what reaches your phone and email. Everything also shows in FireFirst.">
      {save.error ? <ErrorBox error={save.error} /> : null}
      <QueryState query={mine}>
        {(rows) => (
          <>
            {rows.map((row) => (
              <ChoiceCard
                key={row.kind}
                row={row}
                onChange={(change) => save.mutate(rows.map((r) => (r.kind === row.kind ? { ...r, ...change } : r)))}
              />
            ))}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

function ChoiceCard({ row, onChange }: { row: Choice; onChange: (change: Partial<Choice>) => void }) {
  const theme = useTheme();
  const toggle = (channel: 'push' | 'email', label: string, sent: boolean) => (
    <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
      <Label color={sent ? 'text' : 'textSecondary'}>{sent ? label : `${label}: not sent`}</Label>
      {sent ? (
        <Switch
          value={row[channel]}
          disabled={row.required}
          onValueChange={(value) => onChange({ [channel]: value })}
          trackColor={{ true: theme.accent }}
          thumbColor="#ffffff"
          accessibilityLabel={`${row.label}: ${label}`}
        />
      ) : null}
    </Row>
  );
  return (
    <Card>
      <Label type="smallBold">
        {row.label}
        {row.required ? ' · required' : ''}
      </Label>
      {toggle('push', 'Phone', row.department_push)}
      {toggle('email', 'Email', row.department_email)}
    </Card>
  );
}
