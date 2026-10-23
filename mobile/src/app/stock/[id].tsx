import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { api, type Schemas, unwrap } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  Label,
  QueryState,
  Row,
  Screen,
  Section,
  Segmented,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime, formatDay } from '@/lib/format';
import { submit as submitOrQueue } from '@/offline/outbox';

type Mode = 'used' | 'restock' | 'expired' | 'count';

const MODES: { value: Mode; label: string }[] = [
  { value: 'used', label: 'Used' },
  { value: 'restock', label: 'Restock' },
  { value: 'expired', label: 'Dispose' },
  { value: 'count', label: 'Count' },
];

export default function StockScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('used');
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const { me } = useMe();
  const stock = useQuery({
    queryKey: ['stock', id],
    queryFn: () => unwrap(api().GET('/api/v1/inventory/stock/{id}/', { params: { path: { id } } })),
    // Start from whatever list the member came from: instant, and works offline.
    placeholderData: () =>
      queryClient
        .getQueriesData<Schemas['StockLevel'][]>({ queryKey: ['stock'] })
        .flatMap(([, data]) => (Array.isArray(data) ? data : []))
        .find((s) => s.id === id),
  });
  const history = useQuery({
    queryKey: ['stock', id, 'transactions'],
    queryFn: () =>
      unwrap(api().GET('/api/v1/inventory/transactions/', { params: { query: { stock: id, page_size: 10 } } })),
  });

  const adjust = useMutation({
    mutationFn: (body: Schemas['StockAdjustmentRequest']) =>
      submitOrQueue<Schemas['StockAdjustmentResult']>(
        `/api/v1/inventory/stock/${id}/adjust/`,
        body,
        `${body.change > 0 ? '+' : ''}${body.change} ${stock.data?.item_name ?? 'stock'}`,
        me.id,
      ),
    onSuccess: (submitted) => {
      if (submitted.queued) {
        setDone('No signal: saved on this phone. It will sync when you are back online.');
        setAmount(mode === 'count' ? String(quantity) : '1');
        setNote('');
        return;
      }
      const result = submitted.data;
      queryClient.setQueryData(['stock', id], result.stock);
      for (const key of ['stock', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
      setDone(
        `${result.transaction.change > 0 ? '+' : ''}${result.transaction.change} recorded. Now ${result.stock.quantity} on hand.`,
      );
      setAmount(mode === 'count' ? String(result.stock.quantity) : '1');
      setNote('');
    },
  });

  const quantity = stock.data?.quantity ?? 0;
  const n = Number.parseInt(amount, 10);
  const change = mode === 'count' ? n - quantity : mode === 'restock' ? n : -n;
  const valid = Number.isInteger(n) && n >= 0 && change !== 0 && quantity + change >= 0;

  function changeMode(next: Mode) {
    setMode(next);
    setDone(null);
    setAmount(next === 'count' ? String(quantity) : '1');
  }

  function submit() {
    setDone(null);
    adjust.mutate({
      change,
      reason: mode === 'count' ? 'count' : mode,
      note: note.trim(),
    });
  }

  const step = (delta: number) => setAmount(String(Math.max(0, (Number.isInteger(n) ? n : 0) + delta)));

  return (
    <Screen refreshing={stock.isRefetching} onRefresh={() => (stock.refetch(), history.refetch())}>
      <Stack.Screen options={{ title: stock.data?.item_name ?? 'Stock' }} />
      <QueryState query={stock}>
        {(stockData) => {
          const s = stockData;
          return (
            <Card>
              <Label type="small" color="textSecondary">
                {s.location_label}
              </Label>
              <Row style={{ justifyContent: 'space-between' }}>
                <Label type="heading">{s.item_name}</Label>
                <Label type="title" color={s.below_par ? 'warning' : 'text'}>
                  {s.quantity}
                </Label>
              </Row>
              <Row>
                <Label type="small" color="textSecondary">
                  Par {s.par_level} {s.unit}
                </Label>
                {s.below_par ? <Badge text="Below par" tone="warning" /> : null}
                {s.expires_on ? <Badge text={`Expires ${formatDay(s.expires_on)}`} /> : null}
              </Row>
            </Card>
          );
        }}
      </QueryState>

      <Section title="Record">
        <Segmented<Mode> value={mode} onChange={changeMode} options={MODES} />
        <Row style={styles.stepper}>
          <Button title="−" variant="secondary" onPress={() => step(-1)} style={styles.stepButton} />
          <TextInput
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            accessibilityLabel={mode === 'count' ? 'Counted quantity' : 'Amount'}
            style={[
              styles.amount,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />
          <Button title="+" variant="secondary" onPress={() => step(1)} style={styles.stepButton} />
        </Row>
        <Label type="small" color="textSecondary" style={styles.center}>
          {mode === 'count' ? `Counted on hand (currently ${quantity})` : `${stock.data?.unit ?? ''}`}
        </Label>
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="e.g. Run #26-1042" />
        {adjust.error ? <ErrorBox error={adjust.error} /> : null}
        {done ? <Label color="success">{done}</Label> : null}
        <Button
          title={valid ? `Save ${change > 0 ? '+' : ''}${change}` : 'Save'}
          onPress={submit}
          loading={adjust.isPending}
          disabled={!valid || !stock.data}
        />
      </Section>

      <Section title="History">
        <QueryState query={history}>
          {(historyData) =>
            historyData.results.length === 0 ? (
              <Empty text="No changes yet." />
            ) : (
              historyData.results.map((t) => (
                <View key={t.id} style={styles.historyRow}>
                  <Label type="smallBold" color={t.change > 0 ? 'success' : 'text'} style={styles.change}>
                    {t.change > 0 ? '+' : ''}
                    {t.change}
                  </Label>
                  <View style={{ flex: 1 }}>
                    <Label type="small">
                      {t.reason.replace(/_/g, ' ')}
                      {t.note ? ` · ${t.note}` : ''}
                    </Label>
                    <Label type="small" color="textSecondary">
                      {formatDateTime(t.created_at)}
                    </Label>
                  </View>
                </View>
              ))
            )
          }
        </QueryState>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexWrap: 'nowrap', justifyContent: 'center' },
  stepButton: { width: 64 },
  amount: {
    width: 110,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 12,
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '700',
  },
  center: { textAlign: 'center' },
  historyRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  change: { width: 44, textAlign: 'right' },
});
