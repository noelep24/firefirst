import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { api, unwrap } from '@/api/client';
import { Badge, Card, Empty, Label, QueryState, Row, Screen } from '@/components/ui';
import { humanize } from '@/lib/format';
import { apparatusStatus } from '@/lib/labels';

export default function RigsScreen() {
  const rigs = useQuery({
    queryKey: ['apparatus'],
    queryFn: () => unwrap(api().GET('/api/v1/apparatus/', { params: { query: { page_size: 200 } } })),
  });

  return (
    <Screen
      tab
      title="Rigs"
      subtitle="Tap a rig to check it or report a problem"
      refreshing={rigs.isRefetching}
      onRefresh={rigs.refetch}>
      <QueryState query={rigs}>
        {(rigsData) =>
          rigsData.results.length === 0 ? (
            <Empty text="No apparatus yet. An officer can add them in the admin." />
          ) : (
            rigsData.results.map((rig) => {
              const status = apparatusStatus[rig.status ?? 'in_service'];
              return (
                <Card key={rig.id} onPress={() => router.push({ pathname: '/rig/[id]', params: { id: rig.id } })}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="heading">{rig.unit_number}</Label>
                    <Badge text={status.label} tone={status.tone} />
                  </Row>
                  <Label type="small" color="textSecondary">
                    {[humanize(rig.apparatus_type), rig.station_name].filter(Boolean).join(' · ')}
                  </Label>
                  {rig.open_work_orders ? (
                    <Label type="small" color="warning">
                      {rig.open_work_orders} open work order{rig.open_work_orders === 1 ? '' : 's'}
                    </Label>
                  ) : null}
                </Card>
              );
            })
          )
        }
      </QueryState>
    </Screen>
  );
}
