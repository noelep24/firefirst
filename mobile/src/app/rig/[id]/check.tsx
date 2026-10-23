import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import type { Schemas } from '@/api/client';
import { useMe } from '@/auth/auth-context';
import { Button, Card, ErrorBox, Field, Label, QueryState, Row, Screen, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useChecklists, useRig } from '@/lib/queries';
import { submit as submitOrQueue } from '@/offline/outbox';

type Status = 'ok' | 'deficient' | 'na';
type Answer = { status: Status; note: string };

const CHOICES: { value: Status; label: string }[] = [
  { value: 'ok', label: 'OK' },
  { value: 'deficient', label: 'Problem' },
  { value: 'na', label: 'N/A' },
];

export default function RigCheckScreen() {
  const params = useLocalSearchParams<{ id: string; template: string }>();
  const apparatusId = Number(params.id);
  const templateId = Number(params.template);
  const queryClient = useQueryClient();

  const { me } = useMe();
  const rig = useRig(apparatusId);
  const checklists = useChecklists();
  // A query-shaped view of the one checklist, for QueryState.
  const template = { ...checklists, data: checklists.data?.find((t) => t.id === templateId) };

  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [mileage, setMileage] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: (body: Schemas['InspectionRequest']) =>
      submitOrQueue<Schemas['Inspection']>(
        '/api/v1/inspections/',
        body,
        `Rig check · ${rig.data?.unit_number ?? 'apparatus'}`,
        me.id,
      ),
    onSuccess: () => {
      for (const key of ['apparatus', 'inspections', 'work-orders', 'dashboard']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const items = template.data?.items ?? [];
  const answered = items.filter((item) => item.id !== undefined && answers[item.id]).length;

  function answer(itemId: number, status: Status) {
    setAnswers((prev) => ({ ...prev, [itemId]: { status, note: prev[itemId]?.note ?? '' } }));
  }

  function markRestOk() {
    setAnswers((prev) => {
      const next = { ...prev };
      for (const item of items) if (item.id !== undefined && !next[item.id]) next[item.id] = { status: 'ok', note: '' };
      return next;
    });
  }

  function send() {
    if (answered < items.length) {
      setProblem(`Answer every item (${items.length - answered} left).`);
      return;
    }
    const missingNote = items.find(
      (item) => answers[item.id!].status === 'deficient' && !answers[item.id!].note.trim(),
    );
    if (missingNote) {
      setProblem(`Describe the problem with "${missingNote.prompt}".`);
      return;
    }
    setProblem(null);
    submit.mutate({
      apparatus: apparatusId,
      template: templateId,
      mileage: mileage ? Number(mileage) : null,
      engine_hours: hours ? hours : null,
      notes,
      create_work_orders: true,
      results: items.map((item) => ({
        checklist_item: item.id!,
        status: answers[item.id!].status,
        note: answers[item.id!].note.trim(),
      })),
    });
  }

  if (submit.isSuccess && submit.data.queued) {
    const deficient = items.filter((item) => answers[item.id!]?.status === 'deficient').length;
    return (
      <Screen>
        <Card>
          <Label type="title" color="warning">
            Saved on this phone
          </Label>
          <Label>
            No signal right now. Your check
            {deficient ? ` and ${deficient} problem report${deficient === 1 ? '' : 's'}` : ''} will be sent
            automatically when you&apos;re back online.
          </Label>
        </Card>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (submit.isSuccess) {
    const deficient = submit.data.queued ? 0 : (submit.data.data.deficiency_count ?? 0);
    return (
      <Screen>
        <Card>
          <Label type="title" color={deficient ? 'warning' : 'success'}>
            {deficient ? 'Check logged' : 'All good'}
          </Label>
          <Label>
            {deficient
              ? `${deficient} problem${deficient === 1 ? '' : 's'} reported. A work order was opened for each.`
              : 'Every item passed.'}
          </Label>
        </Card>
        <Button title="Done" onPress={() => router.back()} />
      </Screen>
    );
  }

  // Group items under their section headings, keeping checklist order.
  const sections: { name: string; items: Schemas['ChecklistItem'][] }[] = [];
  for (const item of items) {
    const name = item.section || 'General';
    const last = sections.at(-1);
    if (last?.name === name) last.items.push(item);
    else sections.push({ name, items: [item] });
  }

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          {problem ? <Label color="danger">{problem}</Label> : null}
          {submit.error ? <ErrorBox error={submit.error} /> : null}
          <Row style={styles.footerRow}>
            <Button title="Rest OK" variant="secondary" onPress={markRestOk} disabled={answered === items.length} />
            <Button
              title={`Submit (${answered}/${items.length})`}
              onPress={send}
              loading={submit.isPending}
              style={styles.flex}
            />
          </Row>
        </View>
      }>
      <Stack.Screen options={{ title: template.data?.name ?? 'Rig check' }} />
      <QueryState query={template}>
        {(templateData) => (
          <>
            {sections.map((section) => (
              <Section key={section.name} title={section.name}>
                {section.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    answer={answers[item.id!]}
                    onAnswer={(status) => answer(item.id!, status)}
                    onNote={(note) => setAnswers((prev) => ({ ...prev, [item.id!]: { ...prev[item.id!], note } }))}
                  />
                ))}
              </Section>
            ))}
            <Section title="Readings">
              <Row>
                <View style={styles.flex}>
                  <Field label="Mileage" value={mileage} onChangeText={setMileage} keyboardType="number-pad" />
                </View>
                <View style={styles.flex}>
                  <Field label="Engine hours" value={hours} onChangeText={setHours} keyboardType="decimal-pad" />
                </View>
              </Row>
              <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
            </Section>
          </>
        )}
      </QueryState>
    </Screen>
  );
}

function ItemRow({
  item,
  answer,
  onAnswer,
  onNote,
}: {
  item: Schemas['ChecklistItem'];
  answer?: Answer;
  onAnswer: (status: Status) => void;
  onNote: (note: string) => void;
}) {
  const theme = useTheme();
  const colors: Record<Status, string> = { ok: theme.success, deficient: theme.danger, na: theme.textSecondary };
  return (
    <Card>
      <Label>{item.prompt}</Label>
      <Row style={styles.choices}>
        {CHOICES.map((choice) => {
          const selected = answer?.status === choice.value;
          return (
            <Pressable
              key={choice.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${item.prompt}: ${choice.label}`}
              onPress={() => onAnswer(choice.value)}
              style={[
                styles.choice,
                { borderColor: selected ? colors[choice.value] : theme.border },
                selected && { backgroundColor: colors[choice.value] },
              ]}>
              <Label type="smallBold" style={{ color: selected ? theme.accentText : theme.text }}>
                {choice.label}
              </Label>
            </Pressable>
          );
        })}
      </Row>
      {answer?.status === 'deficient' ? (
        <TextInput
          value={answer.note}
          onChangeText={onNote}
          placeholder="What's wrong?"
          placeholderTextColor={theme.textSecondary}
          multiline
          autoFocus
          style={[styles.note, { color: theme.text, borderColor: theme.danger, backgroundColor: theme.background }]}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { gap: Spacing.two },
  footerRow: { flexWrap: 'nowrap' },
  choices: { flexWrap: 'nowrap' },
  choice: {
    flex: 1,
    minHeight: 48,
    borderWidth: 2,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { minHeight: 48, borderWidth: 1.5, borderRadius: 10, padding: Spacing.two, fontSize: 16 },
});
