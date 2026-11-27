import { useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { MEDIA_KINDS, type AnimalDetail } from '@farmplus/shared-types';
import {
  addMediaSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api, apiFileUrl } from '../../api';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  Select,
  TextField,
  Textarea,
} from '../../components/ui';
import { errorMessage } from '../../lib/format';
import { useLocale } from '../../i18n';
import { loadAnimalTypes } from '../../lib/animalTypes';
import { useAsync } from '../../lib/useAsync';
import { NavButton } from './NavButton';
import {
  STATUS_TONE,
  ageLabel,
  breedLabel,
  enumLabel,
  localizeErrors,
  useFarmFormat,
  useFarmsT,
  typeName,
} from './labels';
import { PhotoPicker, uploadPhotos, type PendingPhoto } from './PhotoPicker';
import { useFarm } from './useFarmAccess';

/** Photo thumbnail that degrades to a text label when the (external) image cannot be loaded. */
function Thumb({ url, alt }: { url: string; alt: string }) {
  const t = useFarmsT();
  const [failed, setFailed] = useState(false);
  if (failed) return <Badge tone="warning">{t('detail.imageUnavailable')}</Badge>;
  return (
    <img
      src={apiFileUrl(url)}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{
        width: '6rem',
        height: '6rem',
        objectFit: 'cover',
        borderRadius: 'var(--ds-radius-md)',
      }}
    />
  );
}

export default function AnimalDetailPage() {
  const t = useFarmsT();
  const [locale] = useLocale();
  const types = useAsync(() => loadAnimalTypes(), []);
  const fmt = useFarmFormat();
  const { farmId, animalId } = useParams();
  const { farm, can } = useFarm(farmId);
  const [version, setVersion] = useState(0);
  const { data, loading, error, reload } = useAsync(
    (signal) =>
      api.request<{ animal: AnimalDetail }>('GET', `/farms/${farmId}/animals/${animalId}`, {
        signal,
      }),
    [farmId, animalId, version],
  );
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState({ kind: 'photo', url: '', caption: '' });
  const [mediaErrors, setMediaErrors] = useState<FieldErrors>({});
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  // Set by the register/edit form when the animal was saved but a photo upload failed.
  const photoError = (useLocation().state as { photoError?: string } | null)?.photoError;

  if (error)
    return (
      <Alert tone="danger">
        {error}{' '}
        <button type="button" onClick={reload}>
          {t('common.tryAgain')}
        </button>
      </Alert>
    );
  if (loading && !data) return <p role="status">{t('detail.loading')}</p>;
  const a = data?.animal;
  if (!a) return null;

  const writable = farm?.status === 'active' && !a.archived;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setActionError(undefined);
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const addMedia = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = addMediaSchema.safeParse({
      kind: media.kind,
      url: media.url.trim(),
      ...(media.caption.trim() ? { caption: media.caption.trim() } : {}),
    });
    if (!parsed.success) return setMediaErrors(localizeErrors(fieldErrorsFromZod(parsed.error)));
    setMediaErrors({});
    setBusy(true);
    try {
      await api.request('POST', `/farms/${farmId}/animals/${a.id}/media`, { body: parsed.data });
      setMedia({ kind: media.kind, url: '', caption: '' });
      setVersion((v) => v + 1);
    } catch (e) {
      const fromApi = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setMediaErrors(
        Object.keys(fromApi).length > 0 ? localizeErrors(fromApi) : { _form: errorMessage(e) },
      );
    } finally {
      setBusy(false);
    }
  };

  const birthDate = a.birthDate
    ? a.birthDateEstimated
      ? t('detail.estimated', { date: fmt.date(a.birthDate) })
      : fmt.date(a.birthDate)
    : undefined;
  const catalog = types.data?.animalTypes.find((x) => x.id === a.animalType.id);
  const rearing = a.rearingType
    ? catalog?.rearingTypes?.find((r) => r.key === a.rearingType)
    : undefined;
  const crossNames = (a.crossBreeds ?? []).map((k) => {
    const b = catalog?.breeds.find((x) => x.key === k);
    return b ? typeName(b, locale) : breedLabel({ breed: k }, locale);
  });
  const rows: [string, React.ReactNode][] = [
    [
      t('animals.col.type'),
      [typeName(a.animalType, locale), breedLabel(a, locale)].filter(Boolean).join(' · '),
    ],
    ...(a.breedGroup
      ? [[t('animalForm.breedGroup'), typeName(a.breedGroup, locale)] as [string, string]]
      : []),
    ...(a.rearingType
      ? [
          [
            t('animalForm.rearingType'),
            rearing ? typeName(rearing, locale) : breedLabel({ breed: a.rearingType }, locale),
          ] as [string, string],
        ]
      : []),
    ...(crossNames.length
      ? [[t('animalForm.crossBreeds'), crossNames.join(', ')] as [string, string]]
      : []),
    [t('animals.col.sex'), enumLabel(t, 'sex', a.sex)],
    ...(farm ? [[t('detail.farm'), farm.name] as [string, string]] : []),
    ...(farm?.owner ? [[t('detail.farmOwner'), farm.owner.displayName] as [string, string]] : []),
    [t('detail.birthDate'), birthDate ? `${birthDate} · ${ageLabel(t, a.birthDate) ?? ''}` : '—'],
    [t('detail.acquired'), a.acquisitionDate ? fmt.date(a.acquisitionDate) : '—'],
    [
      t('detail.origin'),
      `${enumLabel(t, 'origin', a.origin.kind)}${a.origin.note ? ` — ${a.origin.note}` : ''}`,
    ],
    [
      t('detail.sire'),
      a.sire ? (
        <Link to={`/farms/${farmId}/animals/${a.sire.id}`}>
          {a.sire.animalCode}
          {a.sire.name ? ` — ${a.sire.name}` : ''}
        </Link>
      ) : (
        t('common.unknown')
      ),
    ],
    [
      t('detail.dam'),
      a.dam ? (
        <Link to={`/farms/${farmId}/animals/${a.dam.id}`}>
          {a.dam.animalCode}
          {a.dam.name ? ` — ${a.dam.name}` : ''}
        </Link>
      ) : (
        t('common.unknown')
      ),
    ],
    [t('detail.offspringRecorded'), String(a.offspringCount)],
    [t('animalForm.color'), a.color ?? '—'],
    [t('detail.registered'), fmt.dateTime(a.createdAt)],
  ];

  return (
    <>
      <p>
        <Link to={`/farms/${farmId}/animals`}>{t('detail.backToAnimals')}</Link>
      </p>
      <div className="ds-row" style={{ justifyContent: 'space-between' }}>
        <h1>
          {a.animalCode}
          {a.name ? ` — ${a.name}` : ''}
        </h1>
        <span className="ds-row">
          <Badge tone={STATUS_TONE[a.currentStatus]}>
            {enumLabel(t, 'status', a.currentStatus)}
          </Badge>
          {a.archived && <Badge tone="warning">{t('common.archived')}</Badge>}
        </span>
      </div>
      {a.archived && (
        <Alert tone="warning">
          {t('detail.archivedNotice', {
            head: a.archivedAt
              ? t('detail.archivedOn', { date: fmt.dateTime(a.archivedAt) })
              : t('common.archived'),
            reason: a.archiveReason ? ` — “${a.archiveReason}”` : '',
          })}
        </Alert>
      )}
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      {photoError && <Alert tone="warning">{photoError}</Alert>}

      <div className="ds-row" style={{ margin: 'var(--ds-space-3) 0' }} data-tour="animal-actions">
        {can('listings.manage') &&
          writable &&
          !a.archived &&
          ['active', 'for_sale'].includes(a.currentStatus) && (
            <NavButton
              to={`/farms/${farmId}/listings/new?animalId=${a.id}`}
              data-tour="animal-list-for-sale"
            >
              {t('detail.listForSale')}
            </NavButton>
          )}
        {can('records.read') && !a.archived && (
          <NavButton
            to={`/farms/${farmId}/animals/${a.id}/assessment`}
            data-tour="animal-assessment"
          >
            {t('detail.saleAssessment')}
          </NavButton>
        )}
        <NavButton to={`/farms/${farmId}/animals/${a.id}/lineage`} data-tour="animal-pedigree">
          {t('pedigree.open')}
        </NavButton>
        {can('records.read') && (
          <>
            <NavButton to={`/farms/${farmId}/animals/${a.id}/growth`} data-tour="animal-growth">
              {t('detail.growth')}
            </NavButton>
            <NavButton to={`/farms/${farmId}/animals/${a.id}/history`} data-tour="animal-history">
              {t('detail.history')}
            </NavButton>
            <NavButton to={`/farms/${farmId}/health?animalId=${a.id}`} data-tour="animal-health">
              {t('overview.health')}
            </NavButton>
          </>
        )}
        {can('animals.write') && writable && (
          <NavButton to={`/farms/${farmId}/animals/${a.id}/edit`} variant="primary">
            {t('detail.edit')}
          </NavButton>
        )}
        {can('animals.archive') && farm?.status === 'active' && !a.archived && (
          <Button variant="danger" onClick={() => setArchiving(true)}>
            {t('detail.archive')}
          </Button>
        )}
        {can('animals.archive') && farm?.status === 'active' && a.archived && (
          <Button
            loading={busy}
            onClick={() =>
              void run(() => api.request('POST', `/farms/${farmId}/animals/${a.id}/restore`))
            }
          >
            {t('detail.restore')}
          </Button>
        )}
      </div>

      <div className="ds-grid ds-grid--2">
        <Card title={t('common.details')} headingLevel={2} data-tour="animal-info">
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'max-content 1fr',
              gap: 'var(--ds-space-2) var(--ds-space-4)',
              margin: 0,
            }}
          >
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--ds-text-muted)' }}>{k}</dt>
                <dd style={{ margin: 0 }}>{v}</dd>
              </div>
            ))}
          </dl>
          {a.notes && <p style={{ marginTop: 'var(--ds-space-3)' }}>{a.notes}</p>}
        </Card>

        <Card title={t('common.photosDocs', { count: a.media.length })} headingLevel={2}>
          {a.media.length === 0 && <p>{t('common.noFiles')}</p>}
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--ds-space-3)' }}>
            {a.media.map((m) => (
              <li key={m.id} className="ds-row" style={{ alignItems: 'flex-start' }}>
                {m.kind === 'photo' ? (
                  <Thumb
                    url={m.url}
                    alt={m.caption ?? t('detail.photoOf', { code: a.animalCode })}
                  />
                ) : (
                  <Badge>{t('common.document')}</Badge>
                )}
                <span style={{ flex: 1 }}>
                  <a href={apiFileUrl(m.url)} target="_blank" rel="noopener noreferrer">
                    {m.caption ?? m.url}
                  </a>
                </span>
                {can('animals.write') && writable && (
                  <Button
                    size="sm"
                    aria-label={t('common.removeFile', { name: m.caption ?? t('common.file') })}
                    onClick={() =>
                      void run(() =>
                        api.request('DELETE', `/farms/${farmId}/animals/${a.id}/media/${m.id}`),
                      )
                    }
                  >
                    {t('common.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {can('animals.write') && writable && a.media.length < 20 && (
            <>
              <h3>{t('photos.choose')}</h3>
              <PhotoPicker
                photos={photos}
                onChange={setPhotos}
                max={20 - a.media.length}
                disabled={busy}
              />
              {photos.length > 0 && (
                <Button
                  variant="primary"
                  loading={busy}
                  style={{ marginTop: 'var(--ds-space-2)' }}
                  onClick={() =>
                    void run(async () => {
                      await uploadPhotos(farmId!, a.id, photos);
                      photos.forEach((p) => URL.revokeObjectURL(p.preview));
                      setPhotos([]);
                    })
                  }
                >
                  {t('photos.upload')}
                </Button>
              )}
            </>
          )}
          {can('animals.write') && writable && (
            <form onSubmit={addMedia} noValidate>
              <h3>{t('common.attachTitle')}</h3>
              <p className="ds-field__hint">{t('detail.attachHint')}</p>
              <Select
                label={t('common.kind')}
                value={media.kind}
                onChange={(e) => setMedia({ ...media, kind: e.target.value })}
              >
                {MEDIA_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {enumLabel(t, 'mediaKind', k)}
                  </option>
                ))}
              </Select>
              <TextField
                label={t('detail.fileUrl')}
                type="url"
                value={media.url}
                onChange={(e) => setMedia({ ...media, url: e.target.value })}
                error={mediaErrors['url'] ?? mediaErrors['_form']}
              />
              <TextField
                label={t('common.caption')}
                value={media.caption}
                onChange={(e) => setMedia({ ...media, caption: e.target.value })}
                error={mediaErrors['caption']}
              />
              <Button type="submit" loading={busy}>
                {t('common.attach')}
              </Button>
            </form>
          )}
        </Card>
      </div>

      <Modal
        open={archiving}
        onClose={() => setArchiving(false)}
        title={t('detail.archiveTitle', { code: a.animalCode })}
        footer={
          <>
            <Button onClick={() => setArchiving(false)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api.request('POST', `/farms/${farmId}/animals/${a.id}/archive`, {
                    body: reason.trim() ? { reason: reason.trim() } : {},
                  });
                  setArchiving(false);
                  setReason('');
                })
              }
            >
              {t('detail.archive')}
            </Button>
          </>
        }
      >
        <p>{t('detail.archiveExplain')}</p>
        <Textarea
          label={t('detail.reasonOptional')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={300}
        />
      </Modal>
    </>
  );
}
