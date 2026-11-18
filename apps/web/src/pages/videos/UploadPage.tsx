import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  POST_VISIBILITIES,
  type PostVisibility,
  type VideoDTO,
  type VideoLimitsDTO,
  type VideoUploadTicket,
} from '@farmplus/shared-types';
import {
  createVideoUploadSchema,
  fieldErrorsFromDetails,
  fieldErrorsFromZod,
  type FieldErrors,
} from '@farmplus/validation';
import { api } from '../../api';
import { Alert, Button, Card, Select, TextField, Textarea } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { localizeFieldErrors } from '../community/localize';
import { useAsync } from '../../lib/useAsync';
import { UploadError, resolveUploadUrl, uploadToProvider, type UploadHandle } from './uploadFile';
import { validateVideoFile } from './videoFeed';

type Phase = 'form' | 'uploading' | 'processing' | 'ready' | 'failed';
const POLL_MS = 3000;
const POLL_LIMIT = 100; // ≈ 5 minutes, then the user can check later from “My videos”
const VISIBILITY_LABEL = {
  public: 'visibility.public',
  followers: 'visibility.followers',
  private: 'visibility.private',
} as const satisfies Record<PostVisibility, string>;

/** `/videos/upload` — signed-URL upload straight to the video provider, then live processing status. */
export default function UploadPage() {
  const t = useT('videos');
  const [locale] = useLocale();
  const limits = useAsync(
    (signal) => api.request<VideoLimitsDTO>('GET', '/videos/limits', { signal }),
    [],
  );
  const [file, setFile] = useState<File>();
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<VideoDTO>();
  const handle = useRef<UploadHandle>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      handle.current?.abort();
    };
  }, []);

  const pollUntilDone = async (id: string) => {
    for (let i = 0; i < POLL_LIMIT && alive.current; i++) {
      const res = await api.request<{ video: VideoDTO }>('POST', `/videos/${id}/refresh`);
      if (!alive.current) return;
      setVideo(res.video);
      const state = res.video.processing.state;
      if (state === 'ready') return setPhase('ready');
      if (state === 'failed') return setPhase('failed');
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !limits.data) return setErrors({ file: t('upload.chooseFile') });
    if (validateVideoFile(file, limits.data)) {
      // Same checks as the shared validator, worded in the user's language.
      const mb = Math.floor(limits.data.maxUploadBytes / 1024 / 1024);
      const key = !limits.data.mimeTypes.includes(file.type)
        ? 'upload.file.type'
        : file.size <= 0
          ? 'upload.file.empty'
          : 'upload.file.tooLarge';
      return setErrors({ file: t(key, { mb }) });
    }
    const declared = {
      title: title.trim(),
      ...(caption.trim() ? { caption: caption.trim() } : {}),
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      visibility,
    };
    const parsed = createVideoUploadSchema.safeParse(declared);
    if (!parsed.success) return setErrors(localizeFieldErrors(fieldErrorsFromZod(parsed.error)));
    setErrors({});
    setPhase('uploading');
    setProgress(0);
    try {
      const ticket = await api.request<VideoUploadTicket>('POST', '/videos/uploads', {
        body: parsed.data,
      });
      setVideo(ticket.video);
      const url = resolveUploadUrl(
        ticket.upload.url,
        import.meta.env.VITE_API_BASE_URL ?? '',
        window.location.origin,
      );
      handle.current = uploadToProvider(file, ticket.upload, url, setProgress);
      await handle.current.promise;
      if (!alive.current) return;
      setPhase('processing');
      await pollUntilDone(ticket.video.id);
    } catch (e) {
      if (!alive.current) return;
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(
        Object.keys(mapped).length
          ? localizeFieldErrors(mapped)
          : {
              _form:
                e instanceof UploadError
                  ? t(`upload.error.${e.uploadCode}`, { status: e.httpStatus ?? '' })
                  : errorMessage(e),
            },
      );
      setPhase('form');
    }
  };

  const reset = () => {
    setPhase('form');
    setFile(undefined);
    setVideo(undefined);
    setProgress(0);
    setErrors({});
  };

  return (
    <>
      <p>
        <Link to="/videos">{t('common.backToVideos')}</Link>
      </p>
      <h1>{t('upload.title')}</h1>
      {limits.error && <Alert tone="danger">{limits.error}</Alert>}
      {phase === 'form' && (
        <form onSubmit={submit} noValidate>
          {errors['_form'] && <Alert tone="danger">{errors['_form']}</Alert>}
          <Card>
            <TextField
              label={t('upload.file')}
              type="file"
              accept={limits.data?.mimeTypes.join(',')}
              onChange={(e) => setFile(e.target.files?.[0])}
              error={
                errors['file'] ?? errors['filename'] ?? errors['mimeType'] ?? errors['sizeBytes']
              }
              hint={
                limits.data
                  ? t('upload.hint', {
                      mb: Math.floor(limits.data.maxUploadBytes / 1048576),
                      seconds: limits.data.maxDurationSeconds,
                    })
                  : undefined
              }
            />
            <TextField
              label={t('common.title')}
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              error={errors['title']}
            />
            <Textarea
              label={t('upload.caption')}
              rows={2}
              maxLength={500}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              error={errors['caption']}
            />
            <Select
              label={t('common.whoCanWatch')}
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PostVisibility)}
            >
              {POST_VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(VISIBILITY_LABEL[v])}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="primary" disabled={!limits.data}>
              {t('common.upload')}
            </Button>
          </Card>
        </form>
      )}
      {phase === 'uploading' && (
        <Card title={t('upload.uploading')} headingLevel={2}>
          <progress
            value={progress}
            max={1}
            aria-label={t('upload.progress')}
            style={{ width: '100%' }}
          />
          <p role="status">{Math.round(progress * 100)}%</p>
          <Button onClick={() => handle.current?.abort()}>{t('upload.cancel')}</Button>
        </Card>
      )}
      {phase === 'processing' && (
        <Card title={t('upload.processingTitle')} headingLevel={2}>
          <p role="status">
            {t('upload.status')}{' '}
            <strong>{t(`state.${video ? video.processing.state : 'processing'}`)}</strong>
            {t('upload.processingBefore')} <Link to="/videos/mine">{t('common.myVideos')}</Link>{' '}
            {t('upload.processingAfter')}
          </p>
        </Card>
      )}
      {phase === 'ready' && video && (
        <Alert tone="success">
          {t('upload.ready')} <Link to={`/videos/watch/${video.id}`}>{t('upload.watchIt')}</Link> ·{' '}
          <button type="button" onClick={reset}>
            {t('upload.another')}
          </button>
        </Alert>
      )}
      {phase === 'failed' && (
        <Alert tone="danger">
          {video?.processing.failure
            ? t('upload.failedReason', {
                // English shows the provider's own explanation; other languages a translation of its code.
                reason:
                  locale === 'en'
                    ? video.processing.failure.message
                    : t(`failure.${video.processing.failure.code}`),
              })
            : t('upload.failed')}{' '}
          <button type="button" onClick={reset}>
            {t('upload.retry')}
          </button>
        </Alert>
      )}
    </>
  );
}
