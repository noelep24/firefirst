import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, unwrap, type Schemas } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { OvertimeOffers } from '@/components/overtime-offers';
import { Badge, Button, Card, Empty, Label, QueryState, Row, Screen, Section, Stat } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { formatDateTime, formatDay, humanize } from '@/lib/format';
import { apparatusStatus, dutyStatus, positionLabel } from '@/lib/labels';

export default function TodayScreen() {
  const { me, isOfficer, signOut } = useMe();
  // Undefined means "the station I work at"; the server picks it.
  const [station, setStation] = useState<number | undefined>();
  const board = useQuery({
    queryKey: ['station-board', station ?? 'mine'],
    queryFn: () => unwrap(api().GET('/api/v1/station-board/', { params: { query: station ? { station } : {} } })),
  });
  const drafts = useQuery({
    queryKey: ['incidents', 'drafts'],
    queryFn: () => unwrap(api().GET('/api/v1/incidents/', { params: { query: { status: 'draft', page_size: 1 } } })),
  });
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => unwrap(api().GET('/api/v1/dashboard/')),
  });

  return (
    <Screen
      tab
      title="Today"
      subtitle={me.department?.name ?? ''}
      refreshing={board.isRefetching || dashboard.isRefetching}
      onRefresh={() => {
        board.refetch();
        drafts.refetch();
        dashboard.refetch();
      }}>
      <OvertimeOffers />
      <QueryState query={board}>
        {(boardData) => <StationBoard board={boardData} myId={me.id} onPickStation={setStation} />}
      </QueryState>

      <Card onPress={() => router.push('/incidents')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label type="heading">Incident reports</Label>
          {drafts.data?.count ? <Badge text={`${drafts.data.count} to finish`} tone="warning" /> : null}
        </Row>
        <Label type="small" color="textSecondary">
          Start a report or finish a draft. Units and crews fill in from the roster.
        </Label>
      </Card>

      <QueryState query={dashboard}>
        {(dashboardData) => {
          const d = dashboardData;
          return (
            <>
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

              <Section title="Department">
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
              </Section>

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
      <Button title="My notifications" variant="secondary" onPress={() => router.push('/notifications')} />
      <Button title="Sign out" variant="ghost" onPress={signOut} />
    </Screen>
  );
}

type Board = Schemas['StationBoard'];
type Person = Schemas['RosterPerson'];

function StationBoard({
  board,
  myId,
  onPickStation,
}: {
  board: Board;
  myId: number;
  onPickStation: (station: number) => void;
}) {
  const { me, station } = board;
  const status = dutyStatus[me.status] ?? dutyStatus.off_duty;
  const onDuty = board.apparatus.reduce((n, rig) => n + rig.crew.length, 0) + board.unassigned.length;
  const openRig = (id: number) => router.push({ pathname: '/rig/[id]', params: { id } });

  return (
    <>
      <Card onPress={me.apparatus ? () => openRig(me.apparatus!) : undefined}>
        <Row style={styles.spread}>
          <Label type="small" color="textSecondary">
            {formatDay(board.date, { weekday: 'long' })}
          </Label>
          <Badge text={status.label} tone={status.tone} />
        </Row>
        <Label type="heading">{me.name}</Label>
        {me.platoon || me.station ? (
          <Label>
            {[me.platoon ? `${me.platoon} Shift` : null, me.station ? stationName(me.station) : null]
              .filter(Boolean)
              .join(' · ')}
          </Label>
        ) : (
          <Label color="textSecondary">No shift assignment yet. An officer can set one up.</Label>
        )}
        {me.position ? (
          <Label type="smallBold">
            {positionLabel(me.position)}
            {me.apparatus_unit ? ` · riding ${me.apparatus_unit}` : ''}
          </Label>
        ) : null}
        {me.note ? (
          <Label type="small" color="textSecondary">
            {me.note}
          </Label>
        ) : null}
        {me.status === 'off_duty' && board.platoon ? (
          <Label type="small" color="textSecondary">
            {board.platoon} Shift is on duty today.
          </Label>
        ) : null}
      </Card>

      {board.stations.length > 1 ? (
        <Row>
          {board.stations.map((s) => (
            <Button
              key={s.id}
              title={`Station ${s.number}`}
              small
              variant={s.id === station?.id ? 'primary' : 'secondary'}
              onPress={() => onPickStation(s.id)}
            />
          ))}
        </Row>
      ) : null}

      {station ? (
        <Section title={stationName(station)}>
          <Label color="textSecondary">
            {board.platoon ? `${board.platoon} Shift · ${onDuty} on duty` : 'No shift rotation set up'}
          </Label>

          {board.shortfalls.length ? (
            <Card>
              <Label type="smallBold" color="danger">
                Short staffed
              </Label>
              {board.shortfalls.map((s) => (
                <Label key={s.rule} type="small">
                  {s.description} (have {s.scheduled})
                </Label>
              ))}
            </Card>
          ) : null}

          {board.apparatus.length === 0 ? <Empty text="No apparatus at this station." /> : null}
          {board.apparatus.map((rig) => {
            const rigStatus = apparatusStatus[rig.status as keyof typeof apparatusStatus];
            return (
              <Card key={rig.id} onPress={() => openRig(rig.id)}>
                <Row style={styles.spread}>
                  <Label type="heading">
                    {rig.unit_number}{' '}
                    <Label type="small" color="textSecondary">
                      {humanize(rig.apparatus_type)}
                    </Label>
                  </Label>
                  {rigStatus && rig.status !== 'in_service' ? (
                    <Badge text={rigStatus.label} tone={rigStatus.tone} />
                  ) : null}
                </Row>
                {rig.visiting ? (
                  <Label type="small" color="warning">
                    {[
                      rig.visiting.home_station_number
                        ? `From Station ${rig.visiting.home_station_number}`
                        : 'Visiting',
                      rig.visiting.covering_for_unit ? `covering for ${rig.visiting.covering_for_unit}` : null,
                      rig.visiting.until ? `through ${formatDay(rig.visiting.until)}` : 'until returned',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Label>
                ) : null}
                {rig.crew.length === 0 ? (
                  <Label type="small" color="textSecondary">
                    Not staffed
                  </Label>
                ) : (
                  rig.crew.map((p) => <CrewLine key={p.user} person={p} isMe={p.user === myId} />)
                )}
              </Card>
            );
          })}

          {board.away.length ? (
            <Card>
              <Label type="smallBold" color="textSecondary">
                Away today
              </Label>
              {board.away.map((rig) => (
                <Label key={rig.id} type="small" onPress={() => openRig(rig.id)}>
                  {rig.unit_number} at Station {rig.station_number}
                  {rig.until ? ` through ${formatDay(rig.until)}` : ' until returned'}
                </Label>
              ))}
            </Card>
          ) : null}

          {board.unassigned.length ? (
            <Card>
              <Label type="smallBold" color="textSecondary">
                No rig assigned
              </Label>
              {board.unassigned.map((p) => (
                <CrewLine key={p.user} person={p} isMe={p.user === myId} />
              ))}
            </Card>
          ) : null}

          {board.on_leave.length || board.traded_off.length ? (
            <Card>
              <Label type="smallBold" color="textSecondary">
                Off this shift
              </Label>
              {board.on_leave.map((p) => (
                <Label key={p.user} type="small">
                  {p.name} · on leave
                </Label>
              ))}
              {board.traded_off.map((p) => (
                <Label key={p.user} type="small">
                  {p.name} · traded off
                </Label>
              ))}
            </Card>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

function CrewLine({ person, isMe }: { person: Person; isMe: boolean }) {
  return (
    <View style={styles.crewLine}>
      <Label type="small" color="textSecondary" style={styles.position}>
        {positionLabel(person.position)}
      </Label>
      <Label style={styles.name}>{withoutRank(person)}</Label>
      {isMe ? <Badge text="You" tone="success" /> : null}
      {person.covering_for ? <Badge text="Trade" tone="warning" /> : null}
      {person.overtime ? <Badge text="OT" tone="warning" /> : null}
    </View>
  );
}

/** "Captain Alex Smith" → "Alex Smith": the position column already says what they do. */
function withoutRank({ name, rank }: Person) {
  return rank && name.startsWith(`${rank} `) ? name.slice(rank.length + 1) : name;
}

function stationName(station: { number: string; name: string }) {
  return `Station ${station.number}${station.name ? ` · ${station.name}` : ''}`;
}

const styles = StyleSheet.create({
  spread: { justifyContent: 'space-between' },
  crewLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: 2 },
  position: { width: 96 },
  name: { flexShrink: 1 },
});
