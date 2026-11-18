import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/theme';

/** Standard screen container: themed background, safe-area padding, optional scrolling. */
export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const padding = { paddingBottom: insets.bottom + theme.spacing.xl };
  if (!scroll) return <View style={[styles.fill, styles.content, padding, style]}>{children}</View>;
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.content, padding, style]}
      keyboardShouldPersistTaps="handled"
      contentInsetAdjustmentBehavior="automatic"
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.lg },
});
