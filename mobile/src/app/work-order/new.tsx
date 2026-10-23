import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch } from 'react-native';

import type { Schemas } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Button, Card, ErrorBox, Field, Label, Row, Screen, Segmented } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { submit as submitOrQueue } from '@/offline/outbox';

type Priority = NonNullable<Schemas['WorkOrderRequest']['priority']>;

export default function NewWorkOrderScreen() {
  const apparatus = Number(useLocalSearchParams<{ apparatus: string }>().apparatus);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [outOfService, setOutOfService] = useState(false);

  const { me } = useMe();
  const create = useMutation({
    mutationFn: () =>
      submitOrQueue(
        '/api/v1/work-orders/',
        { apparatus, title: title.trim(), description, priority, takes_out_of_service: outOfService },
        `Problem report · ${title.trim()}`,
        me.id,
      ),
    onSuccess: () => {
      for (const key of ['apparatus', 'work-orders', 'dashboard']) queryClient.invalidateQueries({ queryKey: [key] });
      router.back();
    },
  });

  return (
    <Screen>
      <Field
        label="What's wrong?"
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Officer-side scene light out"
      />
      <Field label="Details" value={description} onChangeText={setDescription} multiline style={{ minHeight: 100 }} />
      <Label type="smallBold" color="textSecondary">
        Priority
      </Label>
      <Segmented<Priority>
        value={priority}
        onChange={setPriority}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ]}
      />
      <Card>
        <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
          <Label style={{ flex: 1 }}>{"Take this rig out of service until it's fixed"}</Label>
          <Switch
            value={outOfService}
            onValueChange={setOutOfService}
            trackColor={{ true: theme.danger }}
            accessibilityLabel="Take out of service"
          />
        </Row>
      </Card>
      {create.error ? <ErrorBox error={create.error} /> : null}
      <Button title="Submit" onPress={() => create.mutate()} loading={create.isPending} disabled={!title.trim()} />
    </Screen>
  );
}
