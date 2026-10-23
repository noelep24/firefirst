import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { api, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Button, Card, Empty, ErrorBox, Field, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDay, humanize, isoDate } from '@/lib/format';

export default function NewTradeScreen() {
  const { me } = useMe();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [shiftDate, setShiftDate] = useState<string | null>(null);
  const [covering, setCovering] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const assignments = useQuery({
    queryKey: ['assignments'],
    queryFn: () => unwrap(api().GET('/api/v1/assignments/', { params: { query: { page_size: 200 } } })),
  });
  const myAssignment = assignments.data?.results.find((a) => a.user === me.id);
  const platoons = useQuery({
    queryKey: ['platoons'],
    queryFn: () => unwrap(api().GET('/api/v1/platoons/')),
  });
  const myPlatoon = platoons.data?.results.find((p) => p.id === myAssignment?.platoon);

  const today = isoDate();
  const calendar = useQuery({
    queryKey: ['shift-calendar', today],
    queryFn: () =>
      unwrap(
        api().GET('/api/v1/shift-calendar/', {
          params: { query: { start: addDays(today, 1), end: addDays(today, 60) } },
        }),
      ),
  });
  const myShifts = (calendar.data ?? []).filter((d) => d.platoon === myPlatoon?.code).slice(0, 12);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api().POST('/api/v1/shift-trades/', { body: { shift_date: shiftDate!, covering_member: covering!, note } }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      router.back();
    },
  });

  return (
    <Screen>
      <QueryState query={assignments}>
        {(assignmentsData) =>
          !myAssignment ? (
            <Empty text="You don't have a platoon assignment yet, so there's no shift to trade." />
          ) : (
            <>
              <Section title="Your shift">
                <QueryState query={calendar}>
                  {(calendarData) =>
                    myShifts.length === 0 ? (
                      <Empty text="No upcoming shifts found." />
                    ) : (
                      <Row>
                        {myShifts.map((d) => (
                          <Button
                            key={d.date}
                            title={formatDay(d.date)}
                            small
                            variant={shiftDate === d.date ? 'primary' : 'secondary'}
                            onPress={() => setShiftDate(d.date)}
                          />
                        ))}
                      </Row>
                    )
                  }
                </QueryState>
              </Section>

              <Section title="Who's covering?">
                {/* Only members on another platoon are free on your shift day. */}
                {assignmentsData.results
                  .filter((a) => a.user !== me.id && a.platoon !== myAssignment.platoon)
                  .map((a) => (
                    <Card
                      key={a.user}
                      onPress={() => setCovering(a.user)}
                      style={covering === a.user ? { borderWidth: 2, borderColor: theme.accent } : undefined}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Label type={covering === a.user ? 'smallBold' : 'body'}>{a.user_name}</Label>
                        <Label type="small" color="textSecondary">
                          {humanize(a.position ?? '')}
                        </Label>
                      </Row>
                    </Card>
                  ))}
              </Section>

              <Field label="Note (optional)" value={note} onChangeText={setNote} />
              {create.error ? <ErrorBox error={create.error} /> : null}
              <Button
                title="Send request"
                onPress={() => create.mutate()}
                loading={create.isPending}
                disabled={!shiftDate || !covering}
              />
              <Label type="small" color="textSecondary">
                {"They'll be asked to accept, then an officer approves it."}
              </Label>
            </>
          )
        }
      </QueryState>
    </Screen>
  );
}
