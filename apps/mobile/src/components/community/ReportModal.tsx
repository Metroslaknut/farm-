import { REPORT_REASONS, type ReportReason } from '@farmplus/shared-types';
import { humanize } from '@farmplus/shared-utils';
import { reportSchema } from '@farmplus/validation';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { Button, OptionPicker, Text, TextField } from '@/components/ui';
import { useT } from '@/i18n';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

const REPORT_PATH = {
  post: '/posts',
  comment: '/comments',
  video: '/videos',
  live: '/live',
} as const;

const KNOWN_REASONS = new Set<string>(REPORT_REASONS);

/** Report a post, comment, video or live stream to the moderators. */
export function ReportModal({
  target,
  onClose,
  onReported,
}: {
  target: { type: 'post' | 'comment' | 'video' | 'live'; id: string } | null;
  onClose: () => void;
  onReported: () => void;
}) {
  const t = useT('community');
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason('');
    setDetails('');
    setError(undefined);
    setReasonMissing(false);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    const parsed = reportSchema.safeParse({
      reason,
      ...(details.trim() ? { details: details.trim() } : {}),
    });
    if (!parsed.success) {
      setError(undefined);
      return setReasonMissing(true);
    }
    setBusy(true);
    setError(undefined);
    setReasonMissing(false);
    try {
      await api.request('POST', `${REPORT_PATH[target.type]}/${target.id}/reports`, {
        body: parsed.data,
      });
      onReported();
      close();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={target !== null} animationType="slide" transparent onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text variant="heading">{t(`report.title.${target?.type ?? 'content'}`)}</Text>
          <Text muted>{t('report.intro')}</Text>
          <OptionPicker
            label={t('report.reason')}
            value={reason}
            onChange={setReason}
            options={REPORT_REASONS.map((r) => ({
              value: r,
              label: KNOWN_REASONS.has(r) ? t(`report.reasons.${r as ReportReason}`) : humanize(r),
            }))}
            error={reasonMissing ? t('report.chooseReason') : undefined}
          />
          <TextField
            label={t('report.details')}
            value={details}
            onChangeText={setDetails}
            maxLength={500}
            multiline
          />
          {error ? <Text color={theme.colors.error.fg}>{error}</Text> : null}
          <Button title={t('report.send')} loading={busy} onPress={() => void submit()} />
          <Button title={t('report.cancel')} variant="secondary" onPress={close} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: theme.colors.background,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
  },
});
