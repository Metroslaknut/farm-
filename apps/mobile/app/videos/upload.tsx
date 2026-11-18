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
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, OptionPicker, Screen, StateView, Text, TextField } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { useT } from '@/i18n';
import { errorText, validationText } from '@/lib/messages';
import { processingStateInline, videoFailureText, videoFileError } from '@/lib/pickedVideo';
import { toPickedVideo, uploadVideo, type PickedVideo, type UploadHandle } from '@/lib/upload';
import { theme } from '@/theme';

type Phase = 'form' | 'uploading' | 'processing' | 'ready' | 'failed';

/** Shared-schema messages are English: show them in the current language. */
const localised = (errors: FieldErrors): FieldErrors =>
  Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, validationText(v)]));

function Upload() {
  const t = useT('videos');
  const router = useRouter();
  const limits = useAsync(
    (signal) => api.request<VideoLimitsDTO>('GET', '/videos/limits', { signal }),
    [],
  );
  const [file, setFile] = useState<PickedVideo>();
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [phase, setPhase] = useState<Phase>('form');
  const [progress, setProgress] = useState(0);
  const [video, setVideo] = useState<VideoDTO>();
  const handle = useRef<UploadHandle | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      handle.current?.abort();
    };
  }, []);

  const pick = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsEditing: false,
    });
    if (!res.canceled && res.assets[0]) {
      setFile(toPickedVideo(res.assets[0]));
      setErrors({});
    }
  };

  const poll = async (id: string) => {
    for (let i = 0; i < 100 && alive.current; i++) {
      const res = await api.request<{ video: VideoDTO }>('POST', `/videos/${id}/refresh`);
      if (!alive.current) return;
      setVideo(res.video);
      if (res.video.processing.state === 'ready') return setPhase('ready');
      if (res.video.processing.state === 'failed') return setPhase('failed');
      await new Promise((r) => setTimeout(r, 3000));
    }
  };

  const submit = async () => {
    if (!file || !limits.data) return setErrors({ file: t('upload.chooseVideo') });
    const fileError = videoFileError(
      { name: file.name, type: file.mimeType, size: file.size || 1 },
      limits.data,
    );
    if (fileError) return setErrors({ file: fileError });
    const parsed = createVideoUploadSchema.safeParse({
      title: title.trim(),
      ...(caption.trim() ? { caption: caption.trim() } : {}),
      filename: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.size || 1,
      visibility,
    });
    if (!parsed.success) return setErrors(localised(fieldErrorsFromZod(parsed.error)));
    setErrors({});
    setPhase('uploading');
    setProgress(0);
    try {
      const ticket = await api.request<VideoUploadTicket>('POST', '/videos/uploads', {
        body: parsed.data,
      });
      setVideo(ticket.video);
      handle.current = uploadVideo(file, ticket.upload, setProgress);
      await handle.current.promise;
      if (!alive.current) return;
      setPhase('processing');
      await poll(ticket.video.id);
    } catch (e) {
      if (!alive.current) return;
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      setErrors(Object.keys(mapped).length ? localised(mapped) : { _form: errorText(e) });
      setPhase('form');
    }
  };

  if (limits.error) return <StateView kind="error" error={limits.error} onRetry={limits.reload} />;
  if (!limits.data) return <StateView kind="loading" />;
  return (
    <Screen>
      {phase === 'form' && (
        <>
          {errors['_form'] ? <Text color={theme.colors.error.fg}>{errors['_form']}</Text> : null}
          <Button
            title={file ? t('upload.selected', { name: file.name }) : t('upload.chooseVideo')}
            variant="secondary"
            onPress={() => void pick()}
          />
          {errors['file'] || errors['filename'] || errors['mimeType'] || errors['sizeBytes'] ? (
            <Text color={theme.colors.error.fg}>
              {errors['file'] ?? errors['filename'] ?? errors['mimeType'] ?? errors['sizeBytes']}
            </Text>
          ) : (
            <Text variant="caption" muted>
              {t('upload.rules', {
                mb: Math.floor(limits.data.maxUploadBytes / 1048576),
                seconds: limits.data.maxDurationSeconds,
              })}
            </Text>
          )}
          <TextField
            label={t('upload.title')}
            value={title}
            onChangeText={setTitle}
            maxLength={120}
            error={errors['title']}
          />
          <TextField
            label={t('upload.caption')}
            value={caption}
            onChangeText={setCaption}
            maxLength={500}
            multiline
            error={errors['caption']}
          />
          <OptionPicker
            label={t('upload.visibility')}
            value={visibility}
            onChange={(v) => setVisibility(v as PostVisibility)}
            options={POST_VISIBILITIES.map((v) => ({
              value: v,
              label: t(`visibility.${v}`),
            }))}
          />
          <Button title={t('upload.submit')} onPress={() => void submit()} />
        </>
      )}
      {phase === 'uploading' && (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">
            {t('upload.progress', { percent: Math.round(progress * 100) })}
          </Text>
          <View
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            style={{ height: 8, backgroundColor: theme.colors.border, borderRadius: 4 }}
          >
            <View
              style={{
                height: 8,
                width: `${Math.round(progress * 100)}%`,
                backgroundColor: theme.colors.primary,
                borderRadius: 4,
              }}
            />
          </View>
          <Button
            title={t('upload.cancel')}
            variant="secondary"
            onPress={() => handle.current?.abort()}
          />
        </View>
      )}
      {phase === 'processing' && (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t('upload.processingTitle')}</Text>
          <Text muted>
            {t('upload.processingStatus', {
              state: processingStateInline(video?.processing.state ?? 'processing'),
            })}
          </Text>
        </View>
      )}
      {phase === 'ready' && (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading">{t('upload.readyTitle')}</Text>
          <Button
            title={t('upload.watch')}
            onPress={() => video && router.replace(`/videos/${video.id}`)}
          />
        </View>
      )}
      {phase === 'failed' && (
        <View style={{ gap: theme.spacing.md }}>
          <Text variant="heading" color={theme.colors.error.fg}>
            {t('upload.failedTitle')}
          </Text>
          {video?.processing.failure ? (
            <Text>{videoFailureText(video.processing.failure)}</Text>
          ) : null}
          <Button
            title={t('upload.tryAgain')}
            onPress={() => {
              setPhase('form');
              setFile(undefined);
            }}
          />
        </View>
      )}
    </Screen>
  );
}

export default function UploadScreen() {
  return (
    <RequireAuth>
      <Upload />
    </RequireAuth>
  );
}
