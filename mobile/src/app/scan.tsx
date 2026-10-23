import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, unwrap } from '@/api/client';
import { Button, ErrorBox, Label, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<unknown>(null);
  const [looking, setLooking] = useState(false);
  // The camera fires many events per second; only handle the first code.
  const handled = useRef(false);

  async function onScanned({ data }: BarcodeScanningResult) {
    if (handled.current) return;
    handled.current = true;
    setLooking(true);
    try {
      const page = await unwrap(api().GET('/api/v1/inventory/stock/', { params: { query: { search: data } } }));
      if (page.results.length === 1) {
        router.replace({ pathname: '/stock/[id]', params: { id: page.results[0].id } });
      } else {
        // None or several (same item in several locations): show them in the list.
        router.dismissTo({ pathname: '/supplies', params: { q: data } });
      }
    } catch (e) {
      setError(e);
      setLooking(false);
      handled.current = false;
    }
  }

  if (!permission) return <Loading />;

  if (!permission.granted) {
    return (
      <Screen>
        <Label>FireFirst needs the camera to scan item barcodes.</Label>
        {permission.canAskAgain ? (
          <Button title="Allow camera" onPress={requestPermission} />
        ) : (
          <Label color="textSecondary">Turn on camera access for FireFirst in Settings.</Label>
        )}
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr', 'datamatrix'],
        }}
        onBarcodeScanned={looking ? undefined : onScanned}
      />
      <View style={styles.overlay}>
        {looking ? <Loading /> : <Label style={styles.hint}>Point at a barcode</Label>}
        {error ? <ErrorBox error={error} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  overlay: { position: 'absolute', left: Spacing.three, right: Spacing.three, bottom: Spacing.six, gap: Spacing.two },
  hint: { color: 'white', textAlign: 'center', fontWeight: '700' },
});
