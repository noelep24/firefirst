import { useQuery } from '@tanstack/react-query';

import { api, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Badge, Card, Empty, Label, QueryState, Row, Screen } from '@/components/ui';
import { formatDay } from '@/lib/format';

const statusBadge = {
  valid: { label: 'Valid', tone: 'success' },
  expiring: { label: 'Expiring soon', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
} as const;

export default function MyCertificationsScreen() {
  const { me } = useMe();
  const certs = useQuery({
    queryKey: ['certifications', 'mine'],
    queryFn: () => unwrap(api().GET('/api/v1/certifications/', { params: { query: { user: me.id, page_size: 100 } } })),
  });
  const compliance = useQuery({
    queryKey: ['certifications', 'compliance', 'mine'],
    queryFn: () => unwrap(api().GET('/api/v1/certifications/compliance/')),
  });
  const missing = (compliance.data ?? [])
    .filter((r) => r.user === me.id)
    .flatMap((r) => r.problems.filter((p) => p.status === 'missing'));

  return (
    <Screen refreshing={certs.isRefetching} onRefresh={certs.refetch}>
      {missing.length ? (
        <Card>
          <Label type="smallBold" color="danger">
            Required but not on file
          </Label>
          {missing.map((p) => (
            <Label key={p.certification_type}>{p.type_name}</Label>
          ))}
          <Label type="small" color="textSecondary">
            Give your officer a copy of the card so it can be recorded.
          </Label>
        </Card>
      ) : null}
      <QueryState query={certs}>
        {(page) =>
          page.results.length === 0 ? (
            <Empty text="No certifications on file." />
          ) : (
            page.results.map((c) => {
              const badge = statusBadge[c.status as keyof typeof statusBadge];
              return (
                <Card key={c.id}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label type="heading">{c.type_name}</Label>
                    <Badge text={badge.label} tone={badge.tone} />
                  </Row>
                  <Label color="textSecondary">
                    {c.expires_on ? `Expires ${formatDay(c.expires_on, { year: 'numeric' })}` : 'Does not expire'}
                    {c.number ? ` · #${c.number}` : ''}
                  </Label>
                </Card>
              );
            })
          )
        }
      </QueryState>
    </Screen>
  );
}
