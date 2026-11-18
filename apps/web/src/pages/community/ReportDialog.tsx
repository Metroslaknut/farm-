import { useState } from 'react';
import { REPORT_REASONS } from '@farmplus/shared-types';
import { reportSchema } from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Button, Modal, Select, Textarea } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { localizeValidation } from './localize';

const REPORT_PATH = {
  post: '/posts',
  comment: '/comments',
  video: '/videos',
  live: '/live',
} as const;

/** Report a post, comment, video or live stream to the moderators. */
export function ReportDialog({
  target,
  onClose,
  onReported,
}: {
  target: { type: 'post' | 'comment' | 'video' | 'live'; id: string } | null;
  onClose: () => void;
  onReported: () => void;
}) {
  const t = useT('community');
  const [locale] = useLocale();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason('');
    setDetails('');
    setError(undefined);
    onClose();
  };
  const submit = async () => {
    if (!target) return;
    const parsed = reportSchema.safeParse({
      reason,
      ...(details.trim() ? { details: details.trim() } : {}),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      // English keeps the schema's own message; other languages get a translated one.
      if (locale === 'en') return setError(issue?.message ?? t('report.chooseReason'));
      return setError(
        !issue || issue.path[0] === 'reason'
          ? t('report.chooseReason')
          : localizeValidation(issue.message),
      );
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.request('POST', `${REPORT_PATH[target.type]}/${target.id}/reports`, {
        body: parsed.data,
      });
      onReported();
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={target !== null}
      onClose={close}
      title={t(`report.title.${target?.type ?? 'content'}`)}
      footer={
        <>
          <Button onClick={close}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={busy} onClick={() => void submit()}>
            {t('report.send')}
          </Button>
        </>
      }
    >
      <p>{t('report.intro')}</p>
      <Select label={t('report.reason')} value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="">{t('report.choose')}</option>
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {t(`report.reason.${r}`)}
          </option>
        ))}
      </Select>
      <Textarea
        label={t('report.details')}
        rows={3}
        maxLength={500}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
      />
      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
  );
}
