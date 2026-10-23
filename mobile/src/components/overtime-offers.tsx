import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { api, errorMessage, unwrap, type Schemas } from '@/api/client';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime, formatDay } from '@/lib/format';

import { Label } from './label';
import { Badge, Button, Card, Row } from './ui';

type Offer = Schemas['OvertimeOffer'];

/** Overtime you've been offered and can still answer. Shown on Today; nothing when there are none. */
export function OvertimeOffers() {
  const offers = useQuery({
    queryKey: ['overtime-offers', 'open'],
    queryFn: () => unwrap(api().GET('/api/v1/overtime-offers/', { params: { query: { open: true } } })),
    refetchInterval: 60_000,
  });
  const mine = (offers.data?.results ?? []).filter((o) => o.status !== 'expired' && o.status !== 'withdrawn');
  if (mine.length === 0) return null;
  return (
    <>
      {mine.map((offer) => (
        <OfferCard key={offer.id} offer={offer} />
      ))}
    </>
  );
}

function OfferCard({ offer }: { offer: Offer }) {
  const queryClient = useQueryClient();
  const theme = useTheme();
  const answer = useMutation({
    mutationFn: (accept: boolean) =>
      unwrap(
        api().POST(accept ? '/api/v1/overtime-offers/{id}/accept/' : '/api/v1/overtime-offers/{id}/decline/', {
          params: { path: { id: offer.id } },
        }),
      ),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['overtime-offers'] });
      queryClient.invalidateQueries({ queryKey: ['station-board'] });
    },
  });
  const accepted = offer.status === 'accepted';
  const declined = offer.status === 'declined';

  return (
    <Card style={[styles.card, { borderColor: theme.accent }]}>
      <Row style={styles.head}>
        <Label type="heading">Overtime available</Label>
        {accepted ? <Badge text="You volunteered" tone="success" /> : null}
        {declined ? <Badge text="You said no" /> : null}
      </Row>
      <Label type="smallBold">
        {formatDay(offer.date)} · {Number(offer.hours)} hours
      </Label>
      <Label color="textSecondary">{offer.description}</Label>
      {offer.respond_by ? (
        <Label type="small" color="textSecondary">
          Answer by {formatDateTime(offer.respond_by)}. If more than one person volunteers, whoever is highest on the
          list gets it.
        </Label>
      ) : null}
      {answer.error ? (
        <Label type="small" color="danger">
          {errorMessage(answer.error)}
        </Label>
      ) : null}
      <View style={styles.buttons}>
        <Button
          title={accepted ? 'Volunteered ✓' : "I'll work it"}
          variant={accepted ? 'secondary' : 'primary'}
          style={styles.flex}
          loading={answer.isPending && answer.variables === true}
          disabled={accepted}
          onPress={() => answer.mutate(true)}
        />
        <Button
          title={declined ? 'Said no' : "Can't"}
          variant="secondary"
          style={styles.flex}
          loading={answer.isPending && answer.variables === false}
          disabled={declined}
          onPress={() => answer.mutate(false)}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 2 },
  head: { justifyContent: 'space-between' },
  buttons: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
