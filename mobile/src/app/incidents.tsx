import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api, unwrap } from '@/api/client';
import { Badge, Button, Card, Empty, ErrorBox, Label, QueryState, Row, Screen } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { shortLabel } from '@/lib/neris';

export default function IncidentsScreen() {
  const queryClient = useQueryClient();
  const incidents = useQuery({
    queryKey: ['incidents'],
    queryFn: () =>
      unwrap(api().GET('/api/v1/incidents/', { params: { query: { ordering: '-alarm_at', page_size: 50 } } })),
  });
  const create = useMutation({
    mutationFn: () => unwrap(api().POST('/api/v1/incidents/', { body: { alarm_at: new Date().toISOString() } })),
    onSuccess: (incident) => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      router.push({ pathname: '/incident/[id]', params: { id: incident.id } });
    },
  });

  return (
    <Screen refreshing={incidents.isRefetching} onRefresh={incidents.refetch}>
      <Button title="New incident" onPress={() => create.mutate()} loading={create.isPending} />
      {create.error ? <ErrorBox error={create.error} /> : null}
      <QueryState query={incidents}>
        {(data) =>
          data.results.length === 0 ? (
            <Empty text="No incident reports yet." />
          ) : (
            <>
              {data.results.map((i) => (
                <Card key={i.id} onPress={() => router.push({ pathname: '/incident/[id]', params: { id: i.id } })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="smallBold" color="textSecondary">
                      {i.number} · {formatDateTime(i.alarm_at)}
                    </Label>
                    {i.status === 'complete' ? (
                      <Badge text="Complete" tone="success" />
                    ) : (
                      <Badge text={i.missing.length ? `${i.missing.length} to go` : 'Ready'} tone="warning" />
                    )}
                  </Row>
                  <Label type="heading">{i.type_labels.length ? shortLabel(i.type_labels[0]) : 'Type not set'}</Label>
                  <Label type="small" color="textSecondary">
                    {[i.address, i.city].filter(Boolean).join(', ') || 'No address yet'}
                    {i.units.length ? ` · ${i.units.map((u) => u.unit).join(', ')}` : ''}
                  </Label>
                </Card>
              ))}
            </>
          )
        }
      </QueryState>
    </Screen>
  );
}
