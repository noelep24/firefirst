import { StyleSheet, Text, type TextProps } from 'react-native';

import type { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type LabelProps = TextProps & {
  type?: 'title' | 'heading' | 'body' | 'small' | 'smallBold' | 'big';
  color?: ThemeColor;
};

export function Label({ type = 'body', color = 'text', style, ...rest }: LabelProps) {
  const theme = useTheme();
  return <Text style={[{ color: theme[color] }, textStyles[type], style]} {...rest} />;
}

const textStyles = StyleSheet.create({
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 14, lineHeight: 19 },
  smallBold: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  big: { fontSize: 30, lineHeight: 34, fontWeight: '700' },
});
