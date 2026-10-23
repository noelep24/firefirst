import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { api, type Schemas, unwrap } from '@/api/client';
import { Badge, Button, Card, ErrorBox, Field, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { priorityTone, workOrderStatus } from '@/lib/labels';

type Status = NonNullable<Schemas['WorkOrder']['status']>;

export default function WorkOrderScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const queryClient = useQueryClient();
  const [resolution, setResolution] = useState('');

  const order = useQuery({
    queryKey: ['work-orders', id],
    queryFn: () => unwrap(api().GET('/api/v1/work-orders/{id}/', { params: { path: { id } } })),
  });

  const update = useMutation({
    mutationFn: (body: Schemas['PatchedWorkOrderRequest']) =>
      unwrap(api().PATCH('/api/v1/work-orders/{id}/', { params: { path: { id } }, body })),
    onSuccess: (data) => {
      queryClient.setQueryData(['work-orders', id], data);
      // Completing an out-of-service order can put the rig back in service.
      for (const key of ['apparatus', 'work-orders', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });

  const setStatus = (status: Status) =>
    update.mutate(status === 'completed' ? { status, resolution: resolution.trim() } : { status });

  return (
    <Screen refreshing={order.isRefetching} onRefresh={order.refetch}>
      <QueryState query={order}>
        {(orderData) => {
          const wo = orderData;
          const status = workOrderStatus[wo.status ?? 'open'];
          const open = !['completed', 'cancelled'].includes(wo.status ?? 'open');
          return (
            <>
              <Card>
                <Label type="small" color="textSecondary">
                  {wo.apparatus_unit} · reported {formatDateTime(wo.created_at)}
                </Label>
                <Label type="heading">{wo.title}</Label>
                <Row>
                  <Badge text={status.label} tone={status.tone} />
                  <Badge text={wo.priority ?? 'normal'} tone={priorityTone[wo.priority ?? 'normal']} />
                  {wo.takes_out_of_service ? <Badge text="Out of service" tone="danger" /> : null}
                </Row>
                {wo.description ? <Label>{wo.description}</Label> : null}
                {wo.assigned_to ? <Label type="small">Assigned to {wo.assigned_to}</Label> : null}
                {wo.resolution ? <Label type="small">Resolution: {wo.resolution}</Label> : null}
              </Card>

              {open ? (
                <Section title="Update">
                  <Row>
                    {wo.status !== 'in_progress' ? (
                      <Button title="In progress" variant="secondary" small onPress={() => setStatus('in_progress')} />
                    ) : null}
                    {wo.status !== 'waiting_parts' ? (
                      <Button
                        title="Waiting on parts"
                        variant="secondary"
                        small
                        onPress={() => setStatus('waiting_parts')}
                      />
                    ) : null}
                  </Row>
                  <Field
                    label="Resolution"
                    value={resolution}
                    onChangeText={setResolution}
                    placeholder="What was done?"
                    multiline
                  />
                  <Button
                    title="Mark fixed"
                    onPress={() => setStatus('completed')}
                    loading={update.isPending}
                    disabled={!resolution.trim()}
                  />
                </Section>
              ) : null}
              {update.error ? <ErrorBox error={update.error} /> : null}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}
