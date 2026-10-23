import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Label } from './label';
import { Button } from './ui';

export type CodeOption = { value: string; label: string };

/**
 * Pick one NERIS code from a list. Shows the current choice as a field; tapping opens a full-screen, searchable
 * list, so even the 128 incident types are a few keystrokes away ("kitchen", "cardiac", "alarm").
 */
export function CodePicker({
  label,
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  exclude = [],
}: {
  label: string;
  options: CodeOption[];
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  exclude?: string[];
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = options.find((o) => o.value === value);
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = options.filter(
    (o) => !exclude.includes(o.value) && words.every((w) => o.label.toLowerCase().includes(w)),
  );

  return (
    <View style={styles.field}>
      <Label type="smallBold" color="textSecondary">
        {label}
      </Label>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? 'not set'}`}
        onPress={() => setOpen(true)}
        style={[styles.input, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Label color={current ? 'text' : 'textSecondary'} numberOfLines={2}>
          {current ? current.label : placeholder}
        </Label>
      </Pressable>
      {/* Mounted only while open: a long report has dozens of pickers. */}
      {open ? (
        <Modal visible animationType="slide" onRequestClose={() => setOpen(false)}>
          <SafeAreaView style={[styles.modal, { backgroundColor: theme.background }]}>
            <View style={styles.header}>
              <Label type="heading" style={styles.flex}>
                {label}
              </Label>
              <Button title="Close" variant="ghost" small onPress={() => setOpen(false)} />
            </View>
            <TextInput
              autoFocus
              value={search}
              onChangeText={setSearch}
              placeholder="Search"
              placeholderTextColor={theme.textSecondary}
              autoCorrect={false}
              style={[styles.input, styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
            />
            <FlatList
              data={shown}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                value ? (
                  <Option
                    label="Clear"
                    muted
                    onPress={() => {
                      onChange('');
                      setOpen(false);
                    }}
                  />
                ) : undefined
              }
              renderItem={({ item }) => (
                <Option
                  label={item.label}
                  selected={item.value === value}
                  onPress={() => {
                    onChange(item.value);
                    setSearch('');
                    setOpen(false);
                  }}
                />
              )}
            />
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}

function Option({
  label,
  selected,
  muted,
  onPress,
}: {
  label: string;
  selected?: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const parts = label.split(' › ');
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        { borderColor: theme.border, backgroundColor: selected ? theme.backgroundSelected : 'transparent' },
        pressed && styles.pressed,
      ]}>
      {parts.length > 1 ? (
        <Label type="small" color="textSecondary">
          {parts.slice(0, -1).join(' › ')}
        </Label>
      ) : null}
      <Label type={selected ? 'smallBold' : 'body'} color={muted ? 'textSecondary' : 'text'}>
        {parts[parts.length - 1]}
      </Label>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: Spacing.one },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    justifyContent: 'center',
  },
  modal: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, paddingBottom: Spacing.two },
  search: { marginHorizontal: Spacing.three, marginBottom: Spacing.two, fontSize: 17, borderWidth: 0 },
  option: { paddingHorizontal: Spacing.three, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.6 },
});
