import { Alert, Platform } from 'react-native';

import { useMe } from '@/auth/auth-context';
import { Badge, Button, Card, Empty, Label, Row, Screen } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { outbox, useOutbox } from '@/offline/outbox';

function confirm(message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(message)) onYes();
    return;
  }
  Alert.alert('Discard change?', message, [
    { text: 'Keep', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onYes },
  ]);
}

export default function OutboxScreen() {
  const { me } = useMe();
  const items = useOutbox(me.id);

  return (
    <Screen>
      <Label color="textSecondary">
        Changes you made without signal are kept on this phone and sent automatically when you&apos;re back online.
      </Label>
      {items.length ? (
        <Button title="Sync now" onPress={() => outbox.flush(me.id)} />
      ) : (
        <Empty text="Everything is synced." />
      )}
      {items.map((item) => (
        <Card key={item.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Label type="heading">{item.label}</Label>
            {item.failed ? <Badge text="Not saved" tone="danger" /> : <Badge text="Waiting" tone="warning" />}
          </Row>
          <Label type="small" color="textSecondary">
            {formatDateTime(item.createdAt)}
            {item.attempts ? ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'}` : ''}
          </Label>
          {item.error ? (
            <Label type="small" color={item.failed ? 'danger' : 'textSecondary'}>
              {item.failed ? item.error : `Last try: ${item.error}`}
            </Label>
          ) : null}
          <Row>
            {item.failed ? <Button title="Try again" small onPress={() => outbox.retry(item.id, me.id)} /> : null}
            <Button
              title="Discard"
              small
              variant="ghost"
              onPress={() => confirm(`"${item.label}" will be deleted from this phone.`, () => outbox.discard(item.id))}
            />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
