import { POST_LIMITS, type PostDTO, type PostVisibility } from '@farmplus/shared-types';
import { fieldErrorsFromDetails, type FieldErrors } from '@farmplus/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { RequireAuth } from '@/auth/RequireAuth';
import { Button, OptionPicker, Screen, Text, TextField } from '@/components/ui';
import { useT } from '@/i18n';
import {
  communityValidationText,
  toPostPayload,
  validatePostDraft,
  visibilityOptions,
  type MediaDraft,
} from '@/lib/community';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

function NewPost() {
  const router = useRouter();
  const t = useT('community');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<PostVisibility>('public');
  const [media, setMedia] = useState<MediaDraft[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<MediaDraft>) =>
    setMedia((all) => all.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const submit = async () => {
    const draft = { body, visibility, media };
    const local = validatePostDraft(draft);
    if (Object.keys(local).length) return setErrors(local);
    setBusy(true);
    setErrors({});
    try {
      const res = await api.request<{ post: PostDTO }>('POST', '/posts', {
        body: toPostPayload(draft),
      });
      router.replace(`/community/${res.post.id}`);
    } catch (e) {
      const mapped = fieldErrorsFromDetails(
        (e as { details?: { path: string; message: string }[] }).details,
      );
      const localised = Object.fromEntries(
        Object.entries(mapped).map(([path, message]) => [
          path,
          communityValidationText(message, path),
        ]),
      );
      setErrors(Object.keys(localised).length ? localised : { _form: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {errors['_form'] ? <Text color={theme.colors.error.fg}>{errors['_form']}</Text> : null}
      <TextField
        label={t('new.bodyLabel')}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={POST_LIMITS.body}
        style={styles.multiline}
        error={errors['body']}
        hint={`${body.length}/${POST_LIMITS.body}`}
      />
      {media.map((m, i) => (
        <View key={i} style={styles.media}>
          <OptionPicker
            label={t('new.mediaLabel', { n: i + 1 })}
            value={m.kind}
            onChange={(v) => update(i, { kind: v as MediaDraft['kind'] })}
            options={[
              { value: 'image', label: t('new.kind.image') },
              { value: 'video', label: t('new.kind.video') },
            ]}
          />
          <TextField
            label={t('new.urlLabel', { n: i + 1 })}
            value={m.url}
            onChangeText={(v) => update(i, { url: v })}
            autoCapitalize="none"
            keyboardType="url"
            error={errors[`media.${i}.url`]}
          />
          <TextField
            label={t('new.captionLabel', { n: i + 1 })}
            value={m.caption}
            onChangeText={(v) => update(i, { caption: v })}
            maxLength={POST_LIMITS.caption}
          />
          <Button
            title={t('new.removeMedia', { n: i + 1 })}
            variant="ghost"
            onPress={() => setMedia((all) => all.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      <Button
        title={t('new.addMedia')}
        variant="secondary"
        disabled={media.length >= POST_LIMITS.media}
        onPress={() => setMedia((all) => [...all, { kind: 'image', url: '', caption: '' }])}
      />
      <OptionPicker
        label={t('new.visibilityLabel')}
        value={visibility}
        onChange={(v) => setVisibility(v as PostVisibility)}
        options={visibilityOptions()}
      />
      <Text variant="caption" muted>
        {t('new.storageNote')}
      </Text>
      <Button title={t('new.submit')} loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}

export default function NewPostScreen() {
  return (
    <RequireAuth>
      <NewPost />
    </RequireAuth>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 120, textAlignVertical: 'top', paddingTop: theme.spacing.md },
  media: {
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
  },
});
