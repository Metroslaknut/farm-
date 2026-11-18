import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { MfaEnableResponse, MfaSetupResponse } from '@farmplus/shared-types';
import { api } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { useAdminI18n } from '../../../components/admin/i18n';
import { errorMessage } from '../../../lib/format';

/** TOTP enrolment. Administrator permissions only become active once MFA is enabled and verified. */
export default function SecurityPage() {
  const { user, reload } = useAuth();
  const { t } = useAdminI18n();
  const [setup, setSetup] = useState<MfaSetupResponse>();
  // The QR image belongs to one otpauth URL: a result for another (older) setup is ignored when rendering, so
  // nothing has to be reset synchronously when `setup` changes.
  const [qr, setQr] = useState<{ url: string; image?: string; failed?: boolean }>();
  const otpauthUrl = setup?.otpauthUrl;
  const qrCode = qr && qr.url === otpauthUrl ? qr.image : undefined;
  const qrError = qr !== undefined && qr.url === otpauthUrl && qr.failed === true;
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!otpauthUrl) return;
    let active = true;
    void QRCode.toDataURL(otpauthUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
    })
      .then((image) => {
        if (active) setQr({ url: otpauthUrl, image });
      })
      .catch(() => {
        if (active) setQr({ url: otpauthUrl, failed: true });
      });
    return () => {
      active = false;
    };
  }, [otpauthUrl]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h1>{t('security.title')}</h1>
      <section className="adm-card">
        <h2>{t('security.mfaTitle')}</h2>
        {recovery ? (
          <>
            <p>
              <strong>{t('security.enabledNow')}</strong> {t('security.saveCodes')}
            </p>
            <pre className="adm-card" aria-label={t('security.recoveryCodes')}>
              {recovery.join('\n')}
            </pre>
          </>
        ) : user?.mfaEnabled ? (
          <p>{t('security.enabled')}</p>
        ) : setup ? (
          <form
            className="adm-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const res = await api.request<MfaEnableResponse>('POST', '/auth/mfa/enable', {
                  body: { code: code.trim() },
                });
                setRecovery(res.recoveryCodes);
                await reload();
              });
            }}
          >
            <p>{t('security.addKey')}</p>
            <div className="adm-mfa-qr" aria-live="polite">
              {qrCode ? (
                <img src={qrCode} alt={t('security.qrAlt')} />
              ) : qrError ? (
                <p role="status">{t('security.qrError')}</p>
              ) : (
                <p role="status">{t('security.qrCreating')}</p>
              )}
            </div>
            <p className="adm-muted">{t('security.scanHint')}</p>
            <p>
              {t('security.secret')} <code>{setup.secret}</code>
            </p>
            <p className="adm-muted">
              {t('security.orOpen')} <a href={setup.otpauthUrl}>{t('security.authLink')}</a>
            </p>
            <label className="adm-field">
              <span>{t('security.code')}</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            <button className="adm-btn adm-btn--primary" disabled={busy}>
              {t('security.enable')}
            </button>
          </form>
        ) : (
          <>
            <p>{t('security.required')}</p>
            <button
              className="adm-btn adm-btn--primary"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setSetup(await api.request<MfaSetupResponse>('POST', '/auth/mfa/setup')),
                )
              }
            >
              {t('security.start')}
            </button>
          </>
        )}
        {error && (
          <p className="adm-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
