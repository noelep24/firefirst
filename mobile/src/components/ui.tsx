/**
 * Shared building blocks for FireFirst screens. Sized for gloved hands and
 * glanceable use on the apparatus floor: large touch targets, high contrast.
 */
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OutboxBanner } from '@/offline/outbox-banner';

import { Label } from './label';

export { Label };

type ScreenProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Tab screens have no native header, so they draw their own title and respect the top safe area. */
  tab?: boolean;
  footer?: ReactNode;
};

export function Screen({ title, subtitle, children, refreshing = false, onRefresh, tab, footer }: ScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={tab ? ['top', 'left', 'right'] : ['left', 'right']}
      style={[styles.flex, { backgroundColor: theme.background }]}>
      <ScrollView
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}>
        {tab ? <OutboxBanner /> : null}
        {title ? (
          <View style={styles.header}>
            <Label type="title">{title}</Label>
            {subtitle ? <Label color="textSecondary">{subtitle}</Label> : null}
          </View>
        ) : null}
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { borderColor: theme.border, backgroundColor: theme.background }]}>{footer}</View>
      ) : null}
    </SafeAreaView>
  );
}

export function Card({ style, onPress, children, ...rest }: ViewProps & { onPress?: () => void }) {
  const theme = useTheme();
  const body = (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]} {...rest}>
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Label type="heading">{title}</Label>
        {action}
      </View>
      {children}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: ViewProps['style'];
};

export function Button({ title, onPress, variant = 'primary', disabled, loading, small, style }: ButtonProps) {
  const theme = useTheme();
  const background = {
    primary: theme.accent,
    danger: theme.danger,
    secondary: theme.backgroundSelected,
    ghost: 'transparent',
  }[variant];
  const color = variant === 'primary' || variant === 'danger' ? theme.accentText : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: background, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={[styles.buttonText, small && styles.buttonTextSmall, { color }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Badge({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const theme = useTheme();
  const color = { neutral: theme.textSecondary, success: theme.success, warning: theme.warning, danger: theme.danger }[
    tone
  ];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function Field({ label, error, style, ...props }: TextInputProps & { label: string; error?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Label type="smallBold" color="textSecondary">
        {label}
      </Label>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Label type="small" color="danger">
          {error}
        </Label>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.background }]}>
            <Label type="smallBold" color={selected ? 'text' : 'textSecondary'}>
              {option.label}
            </Label>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ children, style }: ViewProps) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: ThemeColor }) {
  return (
    <Card style={styles.stat}>
      <Label type="big" color={tone ?? 'text'}>
        {value}
      </Label>
      <Label type="small" color="textSecondary">
        {label}
      </Label>
    </Card>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <Label color="textSecondary" style={styles.empty}>
      {text}
    </Label>
  );
}

export function Loading() {
  return <ActivityIndicator style={styles.empty} />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <View style={[styles.errorBox, { borderColor: theme.danger }]} accessibilityRole="alert">
      <Label color="danger">{message}</Label>
      {onRetry ? <Button title="Try again" variant="secondary" small onPress={onRetry} /> : null}
    </View>
  );
}

/**
 * Render loading / error / content for a react-query result. The loaded data is
 * passed to `children` rather than read from the query inside it: React
 * Compiler treats `query.data!.x` in a closure as a dependency and reads it
 * during render, before the data exists.
 */
export function QueryState<T>({
  query,
  children,
}: {
  query: { data: T | undefined; isPending: boolean; error: unknown; refetch: () => unknown; fetchStatus?: string };
  children: (data: T) => ReactNode;
}) {
  // Paused = waiting for a connection, with nothing cached to show.
  if (query.isPending && query.fetchStatus === 'paused')
    return <Empty text="No signal. This will load when you're back online." />;
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorBox error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data as T)}</>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screenContent: {
    padding: Spacing.three,
    paddingBottom: Spacing.six,
    gap: Spacing.three,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  header: { gap: Spacing.one, marginBottom: Spacing.one },
  footer: { padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: 14, padding: Spacing.three, gap: Spacing.two },
  pressed: { opacity: 0.7 },
  section: { gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonSmall: { minHeight: 40, paddingHorizontal: Spacing.three },
  buttonText: { fontSize: 17, fontWeight: '700' },
  buttonTextSmall: { fontSize: 15 },
  badge: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  field: { gap: Spacing.one },
  input: { minHeight: 50, borderWidth: 1, borderRadius: 10, paddingHorizontal: Spacing.three, fontSize: 17 },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segment: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  stat: { flexGrow: 1, flexBasis: '45%', gap: 0 },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
  errorBox: { borderWidth: 1.5, borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
});
