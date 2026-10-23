import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { api, type Schemas, unwrap } from '@/api/client';
import { Button, ErrorBox, Field, Label, Row, Screen } from '@/components/ui';
import { isoDate, isValidIsoDate } from '@/lib/format';
import { leaveTypes } from '@/lib/labels';

type LeaveType = Schemas['LeaveRequestRequest']['leave_type'];

export default function NewLeaveScreen() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<LeaveType>('vacation');
  const [start, setStart] = useState(isoDate());
  const [end, setEnd] = useState(isoDate());
  const [reason, setReason] = useState('');

  const startOk = isValidIsoDate(start);
  const endOk = isValidIsoDate(end) && (!startOk || end >= start);

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api().POST('/api/v1/leave-requests/', { body: { leave_type: type, start_date: start, end_date: end, reason } }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave'] });
      router.back();
    },
  });

  return (
    <Screen>
      <Label type="smallBold" color="textSecondary">
        Type
      </Label>
      <Row>
        {leaveTypes.map((t) => (
          <Button
            key={t.value}
            title={t.label}
            small
            variant={type === t.value ? 'primary' : 'secondary'}
            onPress={() => setType(t.value)}
          />
        ))}
      </Row>
      <Row style={{ flexWrap: 'nowrap' }}>
        <View style={{ flex: 1 }}>
          <Field
            label="First day"
            value={start}
            onChangeText={setStart}
            placeholder="YYYY-MM-DD"
            error={startOk ? undefined : 'Use YYYY-MM-DD'}
            autoCorrect={false}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Last day"
            value={end}
            onChangeText={setEnd}
            placeholder="YYYY-MM-DD"
            error={endOk ? undefined : isValidIsoDate(end) ? 'Before first day' : 'Use YYYY-MM-DD'}
            autoCorrect={false}
          />
        </View>
      </Row>
      <Field label="Reason (optional)" value={reason} onChangeText={setReason} multiline />
      {create.error ? <ErrorBox error={create.error} /> : null}
      <Button
        title="Submit request"
        onPress={() => create.mutate()}
        loading={create.isPending}
        disabled={!startOk || !endOk}
      />
    </Screen>
  );
}
