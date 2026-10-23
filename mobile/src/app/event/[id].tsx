import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';

import { api, unwrap } from '@/api/client';
import { Badge, Button, Card, ErrorBox, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { formatDateTime, formatTime, humanize } from '@/lib/format';

export default function EventScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const queryClient = useQueryClient();
  const path = { params: { path: { id } } };

  const event = useQuery({
    queryKey: ['events', 'detail', id],
    queryFn: () => unwrap(api().GET('/api/v1/events/{id}/', path)),
  });
  const rsvp = useMutation({
    mutationFn: (status: 'going' | 'declined') =>
      unwrap(api().POST('/api/v1/events/{id}/rsvp/', { ...path, body: { status } })),
    onSuccess: (data) => {
      queryClient.setQueryData(['events', 'detail', id], data);
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
  });

  return (
    <Screen refreshing={event.isRefetching} onRefresh={event.refetch}>
      <Stack.Screen options={{ title: humanize(event.data?.category ?? 'event') }} />
      <QueryState query={event}>
        {(eventData) => {
          const e = eventData;
          const going = e.attendance.filter((a) => a.status === 'going' || a.status === 'attended');
          return (
            <>
              <Card>
                <Row>
                  {e.is_mandatory ? <Badge text="Mandatory" tone="danger" /> : null}
                  {e.training_hours ? <Badge text={`${Number(e.training_hours)} training hrs`} /> : null}
                </Row>
                <Label type="title">{e.title}</Label>
                <Label color="textSecondary">
                  {formatDateTime(e.starts_at)} – {formatTime(e.ends_at)}
                </Label>
                {e.location ? <Label>{e.location}</Label> : null}
                {e.description ? <Label>{e.description}</Label> : null}
              </Card>

              <Section title="Are you going?">
                <Row style={{ flexWrap: 'nowrap' }}>
                  <Button
                    title="Going"
                    variant={e.my_status === 'going' ? 'primary' : 'secondary'}
                    onPress={() => rsvp.mutate('going')}
                    style={{ flex: 1 }}
                  />
                  <Button
                    title="Can't make it"
                    variant={e.my_status === 'declined' ? 'primary' : 'secondary'}
                    onPress={() => rsvp.mutate('declined')}
                    style={{ flex: 1 }}
                  />
                </Row>
                {rsvp.error ? <ErrorBox error={rsvp.error} /> : null}
              </Section>

              {going.length > 0 ? (
                <Section title={`Going (${going.length})`}>
                  <Card>
                    {going.map((a) => (
                      <Label key={a.user}>{a.user_name}</Label>
                    ))}
                  </Card>
                </Section>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
