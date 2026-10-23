import { router } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { useAuth } from '@/auth/auth-context';
import { Label } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useOutbox } from './outbox';

/** "3 changes waiting to sync" — shown on the main tabs while the outbox isn't empty. */
export function OutboxBanner() {
  const auth = useAuth();
  const items = useOutbox(auth.status === 'signedIn' ? auth.me.id : -1);
  const theme = useTheme();
  if (items.length === 0) return null;
  const failed = items.filter((i) => i.failed).length;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/outbox')}
      style={[styles.banner, { borderColor: failed ? theme.danger : theme.warning }]}>
      <Label type="smallBold" color={failed ? 'danger' : 'warning'}>
        {failed
          ? `${failed} change${failed === 1 ? '' : 's'} couldn't be saved. Tap to review.`
          : `${items.length} change${items.length === 1 ? '' : 's'} saved on this phone, waiting to sync`}
      </Label>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1.5, borderRadius: 12, padding: Spacing.three },
});
