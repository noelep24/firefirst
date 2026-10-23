import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Badge, Button, Card, Empty, Label, QueryState, Row, Screen, Section, Stat } from '@/components/ui';
import { formatDateTime, formatDay, humanize } from '@/lib/format';

export default function TodayScreen() {
  const { me, isOfficer, signOut } = useMe();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => unwrap(api().GET('/api/v1/dashboard/')),
  });

  return (
    <Screen
      tab
      title="Today"
      subtitle={`${me.department?.name ?? ''} · ${me.full_name || me.username}`}
      refreshing={dashboard.isRefetching}
      onRefresh={dashboard.refetch}>
      <QueryState query={dashboard}>
        {(dashboardData) => {
          const d = dashboardData;
          return (
            <>
              <Card onPress={() => router.navigate('/schedule')}>
                <Label type="small" color="textSecondary">
                  {formatDay(d.date, { weekday: 'long' })}
                </Label>
                <Label type="heading">
                  {d.platoon_on_duty ? `${d.platoon_on_duty} Shift on duty` : 'No rotation set up'}
                </Label>
              </Card>

              {d.apparatus_out_of_service.length > 0 ? (
                <Card>
                  <Label type="smallBold" color="danger">
                    Out of service
                  </Label>
                  <Row>
                    {d.apparatus_out_of_service.map((rig) => (
                      <Button
                        key={rig.id}
                        title={rig.unit_number}
                        variant="danger"
                        small
                        onPress={() => router.push({ pathname: '/rig/[id]', params: { id: rig.id } })}
                      />
                    ))}
                  </Row>
                </Card>
              ) : null}

              <Row>
                <Stat
                  label="Open work orders"
                  value={d.open_work_orders}
                  tone={d.open_work_orders ? 'warning' : undefined}
                />
                <Stat
                  label="Maintenance due"
                  value={d.maintenance_due}
                  tone={d.maintenance_due ? 'warning' : undefined}
                />
                <Stat label="Below par" value={d.stock_below_par} tone={d.stock_below_par ? 'warning' : undefined} />
                <Stat
                  label="Expiring ≤ 30 days"
                  value={d.stock_expiring_30_days}
                  tone={d.stock_expiring_30_days ? 'danger' : undefined}
                />
                {isOfficer ? (
                  <>
                    <Stat label="Leave to review" value={d.pending_leave_requests ?? 0} />
                    <Stat label="Trades to approve" value={d.pending_shift_trades ?? 0} />
                  </>
                ) : null}
              </Row>

              {d.certifications_needing_attention ? (
                <Card onPress={() => router.push('/certifications')}>
                  <Label type="smallBold" color="warning">
                    {isOfficer ? 'Department certifications' : 'Your certifications'}
                  </Label>
                  <Label>
                    {d.certifications_needing_attention} expiring soon or expired.{' '}
                    {isOfficer ? 'Review on the web app.' : 'Tap to see which.'}
                  </Label>
                </Card>
              ) : null}

              {isOfficer && d.staffing_shortfall_days.length ? (
                <Card onPress={() => router.navigate('/schedule')}>
                  <Label type="smallBold" color="danger">
                    Short staffed
                  </Label>
                  <Label>{d.staffing_shortfall_days.map((day) => formatDay(day)).join(', ')}</Label>
                </Card>
              ) : null}

              <Section title="Next 7 days">
                {d.upcoming_events.length === 0 ? <Empty text="Nothing scheduled." /> : null}
                {d.upcoming_events.map((event) => (
                  <Card
                    key={event.id}
                    onPress={() => router.push({ pathname: '/event/[id]', params: { id: event.id } })}>
                    <Row>
                      <Label type="smallBold" color="textSecondary">
                        {formatDateTime(event.starts_at)}
                      </Label>
                      {event.is_mandatory ? <Badge text="Mandatory" tone="danger" /> : null}
                    </Row>
                    <Label type="heading">{event.title}</Label>
                    <Label type="small" color="textSecondary">
                      {humanize(event.category)}
                    </Label>
                  </Card>
                ))}
              </Section>
            </>
          );
        }}
      </QueryState>
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}
