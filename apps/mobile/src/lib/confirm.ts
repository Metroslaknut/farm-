import { Alert, Platform } from 'react-native';
import { t } from '@/i18n';

/**
 * Ask the user to confirm a (usually destructive) action. Native: a system alert. Web (dev only): window.confirm,
 * because React Native's Alert.alert does nothing on web.
 */
export function confirmAction(
  title: string,
  message: string,
  confirmLabel: string,
  destructive = true,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(
      typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`),
    );
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: t('common', 'cancel'), style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
