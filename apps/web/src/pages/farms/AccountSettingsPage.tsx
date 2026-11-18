import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, TextField } from '../../components/ui';
import { useAuth } from '../../auth/AuthContext';
import { api } from '../../api';
import { errorMessage } from '../../lib/format';
import { useT } from '../../i18n';

export default function AccountSettingsPage() {
  const { user, reload } = useAuth();
  const t = useT('layout');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      await api.request('PATCH', '/users/me', { body: { displayName: displayName.trim() } });
      await reload();
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('accountSettings.title')} headingLevel={1} style={{ maxWidth: '36rem' }}>
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('accountSettings.displayName')}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
          maxLength={80}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">{t('accountSettings.saved')}</Alert>}
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          style={{ marginTop: 'var(--ds-space-3)' }}
        >
          {t('accountSettings.save')}
        </Button>
      </form>
    </Card>
  );
}
