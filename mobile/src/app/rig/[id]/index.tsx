import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { api, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Badge, Button, Card, Empty, ErrorBox, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { formatDateTime, formatDay, humanize } from '@/lib/format';
import { apparatusStatus, priorityTone, workOrderStatus } from '@/lib/labels';
import { checklistsFor, useChecklists, useRig } from '@/lib/queries';

export default function RigScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const { isOfficer } = useMe();
  const rig = useRig(id);
  const checklists = useChecklists();
  const workOrders = useQuery({
    queryKey: ['work-orders', { apparatus: id, open: true }],
    queryFn: () => unwrap(api().GET('/api/v1/work-orders/', { params: { query: { apparatus: id, open: true } } })),
  });
  const inspections = useQuery({
    queryKey: ['inspections', { apparatus: id }],
    queryFn: () => unwrap(api().GET('/api/v1/inspections/', { params: { query: { apparatus: id, page_size: 5 } } })),
  });

  const refreshing = rig.isRefetching || workOrders.isRefetching || inspections.isRefetching;
  const refresh = () => {
    rig.refetch();
    checklists.refetch();
    workOrders.refetch();
    inspections.refetch();
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: rig.data?.unit_number ?? 'Apparatus' }} />
      <QueryState query={rig}>
        {(rigData) => {
          const r = rigData;
          const status = apparatusStatus[r.status ?? 'in_service'];
          return (
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <Label type="title">{r.unit_number}</Label>
                <Badge text={status.label} tone={status.tone} />
              </Row>
              <Label color="textSecondary">
                {[humanize(r.apparatus_type), r.station_name, [r.year, r.make, r.model].filter(Boolean).join(' ')]
                  .filter(Boolean)
                  .join(' · ')}
              </Label>
              <Label type="small" color="textSecondary">
                {(r.mileage ?? 0).toLocaleString()} mi · {r.engine_hours ?? '0'} engine hrs
              </Label>
            </Card>
          );
        }}
      </QueryState>

      {isOfficer ? <RigLocation id={id} /> : null}

      <Section title="Rig check">
        <QueryState query={checklists}>
          {(all) =>
            checklistsFor(all, rig.data).length === 0 ? (
              <Empty text="No checklist is set up for this type of rig." />
            ) : (
              checklistsFor(all, rig.data).map((template) => (
                <Button
                  key={template.id}
                  title={`Start: ${template.name}`}
                  onPress={() => router.push({ pathname: '/rig/[id]/check', params: { id, template: template.id } })}
                />
              ))
            )
          }
        </QueryState>
      </Section>

      <Section
        title="Open work orders"
        action={
          <Button
            title="Report problem"
            variant="secondary"
            small
            onPress={() => router.push({ pathname: '/work-order/new', params: { apparatus: id } })}
          />
        }>
        <QueryState query={workOrders}>
          {(workOrdersData) =>
            workOrdersData.results.length === 0 ? (
              <Empty text="No open work orders." />
            ) : (
              workOrdersData.results.map((wo) => (
                <Card key={wo.id} onPress={() => router.push({ pathname: '/work-order/[id]', params: { id: wo.id } })}>
                  <Row>
                    <Badge
                      text={workOrderStatus[wo.status ?? 'open'].label}
                      tone={workOrderStatus[wo.status ?? 'open'].tone}
                    />
                    <Badge text={wo.priority ?? 'normal'} tone={priorityTone[wo.priority ?? 'normal']} />
                    {wo.takes_out_of_service ? <Badge text="OOS" tone="danger" /> : null}
                  </Row>
                  <Label type="heading">{wo.title}</Label>
                  {wo.description ? (
                    <Label type="small" color="textSecondary" numberOfLines={2}>
                      {wo.description}
                    </Label>
                  ) : null}
                </Card>
              ))
            )
          }
        </QueryState>
      </Section>

      <Section title="Recent checks">
        <QueryState query={inspections}>
          {(inspectionsData) =>
            inspectionsData.results.length === 0 ? (
              <Empty text="No checks logged yet." />
            ) : (
              inspectionsData.results.map((inspection) => (
                <Card key={inspection.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="smallBold">{formatDateTime(inspection.performed_at ?? '')}</Label>
                    {inspection.deficiency_count ? (
                      <Badge text={`${inspection.deficiency_count} deficient`} tone="warning" />
                    ) : (
                      <Badge text="All OK" tone="success" />
                    )}
                  </Row>
                  {inspection.notes ? <Label type="small">{inspection.notes}</Label> : null}
                </Card>
              ))
            )
          }
        </QueryState>
      </Section>
    </Screen>
  );
}

/** Where the rig is, and (for officers) moving it or bringing it back. */
function RigLocation({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const rig = useRig(id);
  const returnHome = useMutation({
    mutationFn: () => unwrap(api().POST('/api/v1/apparatus/{id}/return/', { params: { path: { id } } })),
    onSuccess: (data) => {
      queryClient.setQueryData(['apparatus', id], data);
      for (const key of ['apparatus', 'station-board', 'roster', 'dashboard'])
        queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  const move = rig.data?.current_move;

  return (
    <Section
      title="Location"
      action={
        <Button
          title="Move"
          variant="secondary"
          small
          onPress={() => router.push({ pathname: '/rig/[id]/move', params: { id } })}
        />
      }>
      {move ? (
        <Card>
          <Label type="smallBold" color="warning">
            At {move.station_name} {move.ends_on ? `through ${formatDay(move.ends_on)}` : 'until returned'}
          </Label>
          {move.covering_for_unit ? <Label>Covering for {move.covering_for_unit}</Label> : null}
          {move.reason ? (
            <Label type="small" color="textSecondary">
              {move.reason}
            </Label>
          ) : null}
          <Label type="small" color="textSecondary">
            Home station: {rig.data?.station_name ?? 'none'}
          </Label>
          <Button
            title={`Return to ${rig.data?.station_name ?? 'home station'}`}
            variant="secondary"
            small
            loading={returnHome.isPending}
            onPress={() => returnHome.mutate()}
          />
          {returnHome.error ? <ErrorBox error={returnHome.error} /> : null}
        </Card>
      ) : (
        <Label color="textSecondary">Based at {rig.data?.station_name ?? 'no station'}.</Label>
      )}
    </Section>
  );
}
