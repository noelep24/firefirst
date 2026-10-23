import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { currentServer } from '@/api/client';
import { useAuth } from '@/auth/auth-context';
import { Button, ErrorBox, Field, Label, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(currentServer());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(server, username.trim(), password);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen tab>
        <View style={styles.brand}>
          <Label type="title" color="accent">
            FireFirst
          </Label>
          <Label color="textSecondary">Station inventory, rigs, schedules and events</Label>
        </View>
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {error ? <ErrorBox error={error} /> : null}
        <Button title="Sign in" onPress={submit} loading={busy} disabled={!username || !password} />

        <Pressable onPress={() => setShowServer((s) => !s)} accessibilityRole="button" style={styles.serverToggle}>
          <Label type="small" color="textSecondary">
            Server: {server} {showServer ? '▲' : '▼'}
          </Label>
        </Pressable>
        {showServer ? (
          <Field
            label="Server address"
            value={server}
            onChangeText={setServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://yourdept.firefirst.app"
          />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  brand: { paddingTop: Spacing.six, paddingBottom: Spacing.four, gap: Spacing.one },
  serverToggle: { alignSelf: 'center', padding: Spacing.two },
});
