import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api, type Schemas, unwrap } from '@/api/client';
import { Badge, Card, Empty, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDay, formatTime, humanize, isoDate, parseDate } from '@/lib/format';

const DAYS_AHEAD = 60;

export default function CalendarScreen() {
  const today = isoDate();
  const end = addDays(today, DAYS_AHEAD);

  const events = useQuery({
    queryKey: ['events', today],
    queryFn: () => unwrap(api().GET('/api/v1/events/', { params: { query: { start: today, end, page_size: 200 } } })),
  });
  const shifts = useQuery({
    queryKey: ['shift-calendar', today, 14],
    queryFn: () =>
      unwrap(api().GET('/api/v1/shift-calendar/', { params: { query: { start: today, end: addDays(today, 13) } } })),
  });
  const platoons = useQuery({
    queryKey: ['platoons'],
    queryFn: () => unwrap(api().GET('/api/v1/platoons/')),
  });

  const refresh = () => {
    events.refetch();
    shifts.refetch();
  };

  return (
    <Screen tab title="Calendar" refreshing={events.isRefetching} onRefresh={refresh}>
      <QueryState query={shifts}>
        {(shiftsData) => <ShiftStrip days={shiftsData} platoons={platoons.data?.results ?? []} />}
      </QueryState>
      <QueryState query={events}>{(eventsData) => <EventList events={eventsData.results} />}</QueryState>
    </Screen>
  );
}

function ShiftStrip({ days, platoons }: { days: Schemas['ShiftDay'][]; platoons: Schemas['Platoon'][] }) {
  const theme = useTheme();
  const color = (code: string | null) => platoons.find((p) => p.code === code)?.color ?? theme.textSecondary;
  if (days.every((d) => !d.platoon)) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {days.map((d) => {
        const date = parseDate(d.date);
        return (
          <View key={d.date} style={[styles.day, { backgroundColor: theme.backgroundElement }]}>
            <Label type="small" color="textSecondary">
              {date.toLocaleDateString(undefined, { weekday: 'short' })}
            </Label>
            <Label type="smallBold">{date.getDate()}</Label>
            <View style={[styles.platoon, { backgroundColor: color(d.platoon) }]}>
              <Label type="smallBold" style={{ color: 'white' }}>
                {d.platoon ?? '–'}
              </Label>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function EventList({ events }: { events: Schemas['Event'][] }) {
  if (events.length === 0) return <Empty text={`Nothing on the calendar for the next ${DAYS_AHEAD} days.`} />;
  const byDay = new Map<string, Schemas['Event'][]>();
  for (const event of events) {
    const day = isoDate(new Date(event.starts_at));
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  return (
    <>
      {[...byDay.entries()].map(([day, dayEvents]) => (
        <Section key={day} title={day === isoDate() ? 'Today' : formatDay(day, { weekday: 'long' })}>
          {dayEvents.map((event) => (
            <Card key={event.id} onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}>
              <Row>
                <Label type="smallBold" color="textSecondary">
                  {event.all_day ? 'All day' : `${formatTime(event.starts_at)} – ${formatTime(event.ends_at)}`}
                </Label>
                {event.is_mandatory ? <Badge text="Mandatory" tone="danger" /> : null}
                {event.my_status === 'going' ? <Badge text="Going" tone="success" /> : null}
              </Row>
              <Label type="heading">{event.title}</Label>
              <Label type="small" color="textSecondary">
                {[humanize(event.category ?? 'other'), event.location].filter(Boolean).join(' · ')}
              </Label>
            </Card>
          ))}
        </Section>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  strip: { gap: Spacing.two },
  day: { width: 56, borderRadius: 12, paddingVertical: Spacing.two, alignItems: 'center', gap: Spacing.one },
  platoon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
