import { View } from 'react-native';
import { useT } from '@/i18n';
import { theme } from '@/theme';
import { Card } from './Card';
import { Screen } from './Screen';
import { StatusBadge } from './StatusBadge';
import { Text } from './Text';

/** Foundation placeholder for a feature screen that is not built yet. Shows route params so deep links can be verified. */
export function PlaceholderScreen({
  title,
  description,
  params,
}: {
  title: string;
  description: string;
  params?: Record<string, string | undefined>;
}) {
  const t = useT('common');
  return (
    <Screen>
      <Text variant="title">{title}</Text>
      <Text muted>{description}</Text>
      <Card>
        <StatusBadge tone="warning" label={t('comingSoon')} />
        {Object.entries(params ?? {}).map(([key, value]) => (
          <View key={key} style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Text variant="label" muted>
              {key}
            </Text>
            <Text variant="label" testID={`param-${key}`}>
              {String(value)}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
