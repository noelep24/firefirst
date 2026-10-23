import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { api, type Schemas, unwrap } from '@/api/client';
import { Badge, Button, Card, Empty, Field, Label, QueryState, Row, Screen, Segmented } from '@/components/ui';
import { formatDay, isoDate } from '@/lib/format';

type Filter = 'all' | 'below_par' | 'expiring';

export default function SuppliesScreen() {
  // The scanner sends ?q=<barcode> here when a code matches several stock entries (or none).
  const params = useLocalSearchParams<{ q?: string }>();
  const [search, setSearch] = useState(params.q ?? '');
  const [filter, setFilter] = useState<Filter>('all');
  const [lastQ, setLastQ] = useState(params.q);
  if (params.q !== lastQ) {
    setLastQ(params.q);
    if (params.q !== undefined) setSearch(params.q);
  }

  const query = search.trim();
  const stock = useQuery({
    queryKey: ['stock', { filter, query }],
    queryFn: async (): Promise<Schemas['StockLevel'][]> => {
      if (filter === 'expiring') {
        return unwrap(
          api().GET('/api/v1/inventory/stock/expiring/', {
            params: { query: { days: 30, search: query || undefined } },
          }),
        );
      }
      const page = await unwrap(
        api().GET('/api/v1/inventory/stock/', {
          params: {
            query: { page_size: 200, search: query || undefined, below_par: filter === 'below_par' || undefined },
          },
        }),
      );
      return page.results;
    },
  });

  return (
    <Screen tab title="Supplies" refreshing={stock.isRefetching} onRefresh={stock.refetch}>
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Search"
            value={search}
            onChangeText={setSearch}
            placeholder="Item, SKU or barcode"
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
        </View>
        {Platform.OS !== 'web' ? <Button title="Scan" onPress={() => router.push('/scan')} /> : null}
      </Row>
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'below_par', label: 'Below par' },
          { value: 'expiring', label: 'Expiring' },
        ]}
      />
      <QueryState query={stock}>
        {(stockData) =>
          stockData.length === 0 ? (
            <Empty text={query ? `Nothing matches "${query}".` : 'Nothing here.'} />
          ) : (
            stockData.map((s) => <StockCard key={s.id} stock={s} />)
          )
        }
      </QueryState>
    </Screen>
  );
}

function StockCard({ stock }: { stock: Schemas['StockLevel'] }) {
  const expired = stock.expires_on && stock.expires_on < isoDate();
  return (
    <Card onPress={() => router.push({ pathname: '/stock/[id]', params: { id: stock.id } })}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <Label type="heading" style={{ flex: 1 }}>
          {stock.item_name}
        </Label>
        <Label type="heading" color={stock.below_par ? 'warning' : 'text'}>
          {stock.quantity ?? 0}
        </Label>
      </Row>
      <Label type="small" color="textSecondary">
        {stock.location_label} · par {stock.par_level ?? 0} {stock.unit}
      </Label>
      <Row>
        {stock.below_par ? <Badge text="Below par" tone="warning" /> : null}
        {stock.expires_on ? (
          <Badge
            text={`${expired ? 'Expired' : 'Expires'} ${formatDay(stock.expires_on)}`}
            tone={expired ? 'danger' : 'neutral'}
          />
        ) : null}
      </Row>
    </Card>
  );
}
