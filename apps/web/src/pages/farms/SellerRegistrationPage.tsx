import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type {
  FarmSetupDTO,
  RegistrationStatus,
  RegistrationSummary,
  RegistrationType,
} from '@farmplus/shared-types';
import {
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  submitRegistrationSchema,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Badge, Button, Card, TextField, Textarea, type Tone } from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { forgetRecent } from '../../lib/shared';
import { useAsync } from '../../lib/useAsync';
import { localizeErrors, useFarmFormat, useFarmsT, type FarmsT } from './labels';

/** Same cap as the API schema. */
const MAX_DOCUMENTS = 10;

export const REGISTRATION_TONE: Record<RegistrationStatus, Tone> = {
  PENDING: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

export const registrationStatusLabel = (t: FarmsT, status: RegistrationStatus): string =>
  t(`seller.status.${status}`);

/** The newest registration of a type (the API lists them newest first). */
export const latestOf = (
  registrations: RegistrationSummary[] | undefined,
  type: RegistrationType,
): RegistrationSummary | undefined => registrations?.find((r) => r.type === type);

/** `GET /registrations/mine`, shared by this page and the "approved sellers only" notices. */
export const loadMyRegistrations = (signal?: AbortSignal) =>
  api.request<{ registrations: RegistrationSummary[] }>('GET', '/registrations/mine', {
    ...(signal ? { signal } : {}),
  });

/**
 * `/farms/seller`: apply to become a seller (and verify identity, which seller approval needs), and follow the
 * applications. The API (`/registrations`) enforces one live application per type and the reviewers' decisions.
 */
export default function SellerRegistrationPage() {
  const t = useFarmsT();
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string>();
  const { data, loading, error, reload } = useAsync(
    (signal) => loadMyRegistrations(signal),
    [version],
  );
  const submitted = (type: RegistrationType) => {
    setNotice(t(type === 'seller' ? 'seller.submitted' : 'seller.identitySubmitted'));
    // Seller state shown elsewhere (sell forms) may have been read before this: drop cached copies.
    forgetRecent();
    setVersion((v) => v + 1);
  };

  if (error)
    return (
      <>
        <h1>{t('seller.title')}</h1>
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      </>
    );
  if (loading && !data) return <p role="status">{t('common.loading')}</p>;
  const seller = latestOf(data?.registrations, 'seller');
  const identity = latestOf(data?.registrations, 'identity');
  const identityVerified = identity?.status === 'APPROVED';

  return (
    <>
      <h1>{t('seller.title')}</h1>
      <p data-tour="seller-why">{t('seller.intro')}</p>
      <p className="ds-field__hint">
        <Link to="/help/verify-identity-seller">{t('help.read')}</Link>
      </p>
      {notice && <Alert tone="success">{notice}</Alert>}

      <Card title={t('seller.applicationTitle')} headingLevel={2} data-tour="seller-application">
        {!seller ? (
          <>
            <p>{t('seller.none')}</p>
            <RegistrationForm type="seller" onSubmitted={() => submitted('seller')} />
          </>
        ) : (
          <SellerStatus registration={seller} onSubmitted={() => submitted('seller')} />
        )}
      </Card>

      {seller?.status !== 'APPROVED' && (
        <Card
          title={t('seller.identityTitle')}
          headingLevel={2}
          data-tour="seller-identity"
          style={{ marginTop: 'var(--ds-space-4)' }}
        >
          <p className="ds-field__hint">{t('seller.identityHint')}</p>
          {identity && <RegistrationStatusLine registration={identity} />}
          {identityVerified ? (
            <p>{t('seller.identityVerified')}</p>
          ) : !identity || identity.status === 'REJECTED' ? (
            <RegistrationForm type="identity" onSubmitted={() => submitted('identity')} />
          ) : identity.status === 'SUSPENDED' ? (
            <p>{t('seller.suspendedHelp')}</p>
          ) : (
            <p>{t('seller.waiting')}</p>
          )}
        </Card>
      )}
    </>
  );
}

/**
 * `/farms/owner-request`: ask for the farm-owner role (registration type `farm_owner`, same API as the seller page),
 * which creating a farm needs while the setting `farms.requireFarmOwnerRole` is on. Accounts that can already create
 * farms (`canCreateFarm`) are sent to the farm setup instead of being asked to apply.
 */
export function FarmOwnerRequestPage() {
  const t = useFarmsT();
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string>();
  const { data, loading, error, reload } = useAsync(
    async (signal) => {
      const [mine, setup] = await Promise.all([
        loadMyRegistrations(signal),
        api.request<FarmSetupDTO>('GET', '/farms/me', { signal }),
      ]);
      return { registrations: mine.registrations, canCreateFarm: setup.canCreateFarm };
    },
    [version],
  );
  const submitted = () => {
    setNotice(t('ownerRequest.submitted'));
    forgetRecent(); // the onboarding guard reads /farms/me through the shared cache
    setVersion((v) => v + 1);
  };

  if (error)
    return (
      <>
        <h1>{t('ownerRequest.title')}</h1>
        <Alert tone="danger">
          {error}{' '}
          <button type="button" onClick={reload}>
            {t('common.tryAgain')}
          </button>
        </Alert>
      </>
    );
  if (loading && !data) return <p role="status">{t('common.loading')}</p>;
  const request = latestOf(data?.registrations, 'farm_owner');

  return (
    <>
      <h1>{t('ownerRequest.title')}</h1>
      <p>{t('ownerRequest.intro')}</p>
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card title={t('ownerRequest.cardTitle')} headingLevel={2}>
        {data?.canCreateFarm && request?.status !== 'SUSPENDED' ? (
          <>
            <p>{t('ownerRequest.canCreate')}</p>
            <p>
              <Link to="/farms/new">{t('ownerRequest.createFarm')}</Link>
            </p>
          </>
        ) : !request ? (
          <>
            <p>{t('ownerRequest.none')}</p>
            <RegistrationForm type="farm_owner" onSubmitted={submitted} />
          </>
        ) : (
          <>
            <RegistrationStatusLine registration={request} />
            {(request.status === 'PENDING' || request.status === 'UNDER_REVIEW') && (
              <p>{t('ownerRequest.waiting')}</p>
            )}
            {request.status === 'APPROVED' && (
              <p>
                <Link to="/farms/new">{t('ownerRequest.createFarm')}</Link>
              </p>
            )}
            {request.status === 'SUSPENDED' && <p>{t('seller.suspendedHelp')}</p>}
            {request.status === 'REJECTED' && (
              <>
                <p>{t('ownerRequest.rejected')}</p>
                <RegistrationForm type="farm_owner" onSubmitted={submitted} again />
              </>
            )}
          </>
        )}
      </Card>
      <p className="ds-field__hint" style={{ marginTop: 'var(--ds-space-4)' }}>
        <Link to="/help/request-farm-owner">{t('help.read')}</Link>
      </p>
    </>
  );
}

/** Status badge, submitted date and — for decisions — the reviewer's reason. */
function RegistrationStatusLine({ registration }: { registration: RegistrationSummary }) {
  const t = useFarmsT();
  const fmt = useFarmFormat();
  const showReason =
    registration.decision &&
    (registration.status === 'REJECTED' || registration.status === 'SUSPENDED');
  return (
    <>
      <p
        className="ds-row"
        data-tour={registration.type === 'seller' ? 'seller-status' : undefined}
      >
        <Badge tone={REGISTRATION_TONE[registration.status]}>
          {registrationStatusLabel(t, registration.status)}
        </Badge>
        <span className="ds-field__hint">
          {t('seller.submittedOn', { date: fmt.dateTime(registration.submittedAt) })}
        </span>
      </p>
      {showReason && (
        <Alert
          tone={registration.status === 'SUSPENDED' ? 'danger' : 'warning'}
          data-tour={registration.type === 'seller' ? 'seller-reason' : undefined}
        >
          {t('seller.reason', { reason: registration.decision!.reason })}
        </Alert>
      )}
    </>
  );
}

/** What the applicant can do in each state of their seller application. */
function SellerStatus({
  registration,
  onSubmitted,
}: {
  registration: RegistrationSummary;
  onSubmitted: () => void;
}) {
  const t = useFarmsT();
  return (
    <>
      <RegistrationStatusLine registration={registration} />
      {registration.status === 'PENDING' && <p>{t('seller.pending')}</p>}
      {registration.status === 'UNDER_REVIEW' && <p>{t('seller.underReview')}</p>}
      {registration.status === 'APPROVED' && (
        <>
          <p>{t('seller.approved')}</p>
          <p className="ds-row">
            <Link to="/market/sell">{t('seller.sellAnimals')}</Link>
            <Link to="/shop/sell">{t('seller.sellProducts')}</Link>
          </p>
        </>
      )}
      {registration.status === 'SUSPENDED' && <p>{t('seller.suspendedHelp')}</p>}
      {registration.status === 'REJECTED' && (
        <>
          <p>{t('seller.rejected')}</p>
          <RegistrationForm type="seller" onSubmitted={onSubmitted} again />
        </>
      )}
    </>
  );
}

type DocDraft = { kind: string; url: string };

/**
 * Application form (`submitRegistrationSchema`): business name (sellers, farm owners), a note and https links to
 * documents. Used for seller, identity and farm-owner registrations.
 */
export function RegistrationForm({
  type,
  onSubmitted,
  again = false,
}: {
  type: 'seller' | 'identity' | 'farm_owner';
  onSubmitted: () => void;
  again?: boolean;
}) {
  const t = useFarmsT();
  const [businessName, setBusinessName] = useState('');
  const [note, setNote] = useState('');
  const [docs, setDocs] = useState<DocDraft[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const prefix = `${type}-reg`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = submitRegistrationSchema.safeParse({
      type,
      ...(type !== 'identity' && businessName.trim() ? { businessName: businessName.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      documents: docs
        .filter((d) => d.kind.trim() || d.url.trim())
        .map((d) => ({ kind: d.kind.trim(), url: d.url.trim() })),
    });
    if (!parsed.success) return setErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    setBusy(true);
    setErrors({});
    try {
      await api.request('POST', '/registrations', { body: parsed.data });
      onSubmitted();
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(fromApi).length > 0 ? localizeErrors(fromApi) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate aria-label={t(`seller.form.${type}`)}>
      {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
      {type !== 'identity' && (
        <TextField
          id={`${prefix}-business`}
          label={t(type === 'farm_owner' ? 'ownerRequest.businessName' : 'seller.businessName')}
          hint={t(
            type === 'farm_owner' ? 'ownerRequest.businessNameHint' : 'seller.businessNameHint',
          )}
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          error={errors['businessName']}
          maxLength={120}
        />
      )}
      <Textarea
        id={`${prefix}-note`}
        label={t(type === 'identity' ? 'seller.identityNote' : 'seller.note')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        error={errors['note']}
        rows={3}
        maxLength={1000}
      />
      <fieldset className="ds-field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="ds-field__label">{t('seller.documents')}</legend>
        <p className="ds-field__hint">{t('seller.documentsHint')}</p>
        {docs.map((d, i) => (
          <div key={i} className="ds-grid ds-grid--3">
            <TextField
              id={`${prefix}-doc-${i}-kind`}
              label={t('seller.docKind', { n: i + 1 })}
              value={d.kind}
              onChange={(e) =>
                setDocs(docs.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))
              }
              error={errors[`documents.${i}.kind`]}
              maxLength={40}
            />
            <TextField
              id={`${prefix}-doc-${i}-url`}
              label={t('seller.docUrl', { n: i + 1 })}
              type="url"
              value={d.url}
              onChange={(e) =>
                setDocs(docs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
              }
              error={errors[`documents.${i}.url`]}
            />
            <div style={{ alignSelf: 'end' }}>
              <Button size="sm" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>
                {t('common.remove')}
              </Button>
            </div>
          </div>
        ))}
        {errors['documents'] && <p className="ds-field__error">{errors['documents']}</p>}
        <Button
          size="sm"
          disabled={docs.length >= MAX_DOCUMENTS}
          onClick={() => setDocs([...docs, { kind: '', url: '' }])}
        >
          {t('seller.addDocument')}
        </Button>
      </fieldset>
      <div className="ds-row" style={{ marginTop: 'var(--ds-space-4)' }}>
        <Button type="submit" variant="primary" loading={busy}>
          {t(
            type === 'identity'
              ? 'seller.submitIdentity'
              : type === 'farm_owner'
                ? again
                  ? 'ownerRequest.submitAgain'
                  : 'ownerRequest.submit'
                : again
                  ? 'seller.submitAgain'
                  : 'seller.submit',
          )}
        </Button>
      </div>
    </form>
  );
}
