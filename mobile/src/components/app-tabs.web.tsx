import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TABS } from '@/constants/tabs';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Web build (used for development in a browser): a simple bottom tab bar. */
export default function AppTabs() {
  const theme = useTheme();
  return (
    <Tabs style={styles.flex}>
      <TabSlot style={styles.flex} />
      <TabList style={[styles.bar, { backgroundColor: theme.background, borderColor: theme.border }]}>
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.name === 'index' ? '/' : `/${tab.name}`} asChild>
            <TabButton>{tab.label}</TabButton>
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

function TabButton({ children, isFocused, ref: _ref, ...props }: TabTriggerSlotProps) {
  const theme = useTheme();
  return (
    <Pressable {...props} style={styles.button}>
      <View style={[styles.indicator, isFocused && { backgroundColor: theme.accent }]} />
      <Text style={[styles.label, { color: isFocused ? theme.accent : theme.textSecondary }]}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  button: { flex: 1, alignItems: 'center', paddingBottom: Spacing.two, gap: Spacing.two },
  indicator: { height: 3, alignSelf: 'stretch', borderRadius: 2 },
  label: { fontSize: 13, fontWeight: '700' },
});
