import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { api, type Schemas, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Badge, Button, Card, Empty, ErrorBox, Label, QueryState, Row, Screen, Segmented } from '@/components/ui';
import { addDays, formatDay, humanize, isoDate } from '@/lib/format';
import { leaveTypeLabel, requestStatus } from '@/lib/labels';

type Tab = 'roster' | 'leave' | 'trades';

export default function ScheduleScreen() {
  const [tab, setTab] = useState<Tab>('roster');
  return (
    <Screen tab title="Schedule">
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'roster', label: 'Roster' },
          { value: 'leave', label: 'Leave' },
          { value: 'trades', label: 'Trades' },
        ]}
      />
      {tab === 'roster' ? <Roster /> : tab === 'leave' ? <Leave /> : <Trades />}
    </Screen>
  );
}

function Roster() {
  const [date, setDate] = useState(isoDate());
  const roster = useQuery({
    queryKey: ['roster', date],
    queryFn: () => unwrap(api().GET('/api/v1/roster/', { params: { query: { date } } })),
  });

  return (
    <>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <Button title="‹" variant="secondary" small onPress={() => setDate(addDays(date, -1))} />
        <Button
          title={date === isoDate() ? 'Today' : formatDay(date)}
          variant="ghost"
          small
          onPress={() => setDate(isoDate())}
        />
        <Button title="›" variant="secondary" small onPress={() => setDate(addDays(date, 1))} />
      </Row>
      <QueryState query={roster}>
        {(rosterData) => {
          const r = rosterData;
          if (!r.platoon) return <Empty text="No shift rotation has been set up yet." />;
          const byStation = new Map<string, Schemas['RosterPerson'][]>();
          for (const person of r.working) {
            const key = person.station_number ? `Station ${person.station_number}` : 'Unassigned';
            byStation.set(key, [...(byStation.get(key) ?? []), person]);
          }
          return (
            <>
              <Label type="heading">
                {r.platoon} Shift · {r.working.length} on duty
              </Label>
              {r.shortfalls.length ? (
                <Card>
                  <Label type="smallBold" color="danger">
                    Short staffed
                  </Label>
                  {r.shortfalls.map((s) => (
                    <Label key={s.rule} type="small">
                      {s.description} (have {s.scheduled})
                    </Label>
                  ))}
                </Card>
              ) : null}
              {[...byStation.entries()].map(([station, people]) => (
                <Card key={station}>
                  <Label type="smallBold" color="textSecondary">
                    {station}
                  </Label>
                  {people.map((p) => (
                    <Row key={p.user} style={{ justifyContent: 'space-between' }}>
                      <Label>{p.name}</Label>
                      <Row>
                        {p.covering_for ? <Badge text="Trade" tone="warning" /> : null}
                        <Label type="small" color="textSecondary">
                          {humanize(p.position)}
                        </Label>
                      </Row>
                    </Row>
                  ))}
                </Card>
              ))}
              {r.on_leave.length > 0 ? (
                <Card>
                  <Label type="smallBold" color="textSecondary">
                    On leave
                  </Label>
                  {r.on_leave.map((p) => (
                    <Label key={p.user}>{p.name}</Label>
                  ))}
                </Card>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function useInvalidateSchedule() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['leave', 'trades', 'roster', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

function Leave() {
  const { me, isOfficer } = useMe();
  const invalidate = useInvalidateSchedule();
  const leave = useQuery({
    queryKey: ['leave'],
    queryFn: () => unwrap(api().GET('/api/v1/leave-requests/', { params: { query: { page_size: 100 } } })),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'approve' | 'deny' | 'cancel' }) => {
      const path = { params: { path: { id } } };
      if (action === 'cancel') return unwrap(api().POST('/api/v1/leave-requests/{id}/cancel/', path));
      return unwrap(api().POST(`/api/v1/leave-requests/{id}/${action}/`, { ...path, body: {} }));
    },
    onSuccess: invalidate,
  });

  return (
    <>
      <Button title="Request leave" onPress={() => router.push('/leave/new')} />
      {act.error ? <ErrorBox error={act.error} /> : null}
      <QueryState query={leave}>
        {(leaveData) =>
          leaveData.results.length === 0 ? (
            <Empty text="No leave requests." />
          ) : (
            leaveData.results.map((l) => {
              const status = requestStatus[l.status ?? 'pending'];
              const mine = l.user === me.id;
              const pending = l.status === 'pending';
              return (
                <Card key={l.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="smallBold">{mine ? 'You' : l.user_name}</Label>
                    <Badge text={status.label} tone={status.tone} />
                  </Row>
                  <Label type="heading">{leaveTypeLabel(l.leave_type)}</Label>
                  <Label color="textSecondary">
                    {l.start_date === l.end_date
                      ? formatDay(l.start_date)
                      : `${formatDay(l.start_date)} – ${formatDay(l.end_date)}`}
                  </Label>
                  {l.reason ? <Label type="small">{l.reason}</Label> : null}
                  {l.review_note ? <Label type="small">Note: {l.review_note}</Label> : null}
                  <Row>
                    {isOfficer && pending && !mine ? (
                      <>
                        <Button title="Approve" small onPress={() => act.mutate({ id: l.id, action: 'approve' })} />
                        <Button
                          title="Deny"
                          variant="secondary"
                          small
                          onPress={() => act.mutate({ id: l.id, action: 'deny' })}
                        />
                      </>
                    ) : null}
                    {(mine || isOfficer) && (pending || l.status === 'approved') ? (
                      <Button
                        title="Cancel"
                        variant="ghost"
                        small
                        onPress={() => act.mutate({ id: l.id, action: 'cancel' })}
                      />
                    ) : null}
                  </Row>
                </Card>
              );
            })
          )
        }
      </QueryState>
    </>
  );
}

type TradeAction = 'accept' | 'decline' | 'approve' | 'deny' | 'cancel';

function Trades() {
  const { me, isOfficer } = useMe();
  const invalidate = useInvalidateSchedule();
  const trades = useQuery({
    queryKey: ['trades'],
    queryFn: () => unwrap(api().GET('/api/v1/shift-trades/', { params: { query: { page_size: 100 } } })),
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: TradeAction }) =>
      unwrap(api().POST(`/api/v1/shift-trades/{id}/${action}/`, { params: { path: { id } } })),
    onSuccess: invalidate,
  });

  function actions(
    t: Schemas['ShiftTrade'],
  ): { action: TradeAction; label: string; variant?: 'secondary' | 'ghost' }[] {
    const list: ReturnType<typeof actions> = [];
    if (t.status === 'pending_partner' && t.covering_member === me.id) {
      list.push({ action: 'accept', label: 'Accept' }, { action: 'decline', label: 'Decline', variant: 'secondary' });
    }
    if (t.status === 'pending_approval' && isOfficer && t.requester !== me.id && t.covering_member !== me.id) {
      list.push({ action: 'approve', label: 'Approve' }, { action: 'deny', label: 'Deny', variant: 'secondary' });
    }
    if (t.requester === me.id && ['pending_partner', 'pending_approval', 'approved'].includes(t.status ?? '')) {
      list.push({ action: 'cancel', label: 'Cancel', variant: 'ghost' });
    }
    return list;
  }

  return (
    <>
      <Button title="Trade a shift" onPress={() => router.push('/trade/new')} />
      {act.error ? <ErrorBox error={act.error} /> : null}
      <QueryState query={trades}>
        {(tradesData) =>
          tradesData.results.length === 0 ? (
            <Empty text="No shift trades." />
          ) : (
            tradesData.results.map((t) => {
              const status = requestStatus[t.status ?? 'pending_partner'];
              return (
                <Card key={t.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="heading">{formatDay(t.shift_date)}</Label>
                    <Badge text={status.label} tone={status.tone} />
                  </Row>
                  <Label>
                    {t.covering_member === me.id ? 'You' : t.covering_member_name} covering for{' '}
                    {t.requester === me.id ? 'you' : t.requester_name}
                  </Label>
                  {t.note ? <Label type="small">{t.note}</Label> : null}
                  <Row>
                    {actions(t).map((a) => (
                      <Button
                        key={a.action}
                        title={a.label}
                        variant={a.variant}
                        small
                        onPress={() => act.mutate({ id: t.id, action: a.action })}
                      />
                    ))}
                  </Row>
                </Card>
              );
            })
          )
        }
      </QueryState>
    </>
  );
}
