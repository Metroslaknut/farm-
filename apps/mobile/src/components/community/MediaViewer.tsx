import type { PostMedia } from '@farmplus/shared-types';
import { useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from '@/components/ui';
import { useT } from '@/i18n';
import { theme } from '@/theme';

/** Image tiles open a full-screen viewer; videos open in the system player/browser (files stay on external storage). */
export function MediaStrip({ media }: { media: PostMedia[] }) {
  const t = useT('community');
  const [index, setIndex] = useState<number | null>(null);
  if (media.length === 0) return null;
  const current = index === null ? undefined : media[index];
  return (
    <>
      <View style={styles.grid}>
        {media.map((m, i) => (
          <Pressable
            key={m.id}
            accessibilityRole="imagebutton"
            accessibilityLabel={
              m.kind === 'image'
                ? m.caption
                  ? t('media.openPhotoCaption', {
                      n: i + 1,
                      total: media.length,
                      caption: m.caption,
                    })
                  : t('media.openPhoto', { n: i + 1, total: media.length })
                : m.caption
                  ? t('media.playVideoCaption', { caption: m.caption })
                  : t('media.playVideo')
            }
            onPress={() => (m.kind === 'video' ? void Linking.openURL(m.url) : setIndex(i))}
            style={[styles.tile, media.length === 1 && styles.tileWide]}
          >
            {m.kind === 'image' ? (
              <Image
                source={{ uri: m.url }}
                style={styles.fill}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
              />
            ) : (
              <View style={[styles.fill, styles.video]}>
                <Text variant="heading" color={theme.colors.textOnPrimary}>
                  {t('media.videoTile')}
                </Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
      <Modal
        visible={current !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setIndex(null)}
      >
        <View style={styles.viewer}>
          {current && (
            <Image
              source={{ uri: current.url }}
              style={styles.full}
              resizeMode="contain"
              accessibilityLabel={current.caption ?? t('media.photo')}
            />
          )}
          {current?.caption ? (
            <Text color={theme.colors.textOnPrimary}>{current.caption}</Text>
          ) : null}
          <View style={styles.controls}>
            {media.filter((m) => m.kind === 'image').length > 1 && (
              <>
                <Button
                  title={t('media.previous')}
                  variant="secondary"
                  disabled={(index ?? 0) === 0}
                  onPress={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))}
                />
                <Button
                  title={t('media.next')}
                  variant="secondary"
                  disabled={(index ?? 0) >= media.length - 1}
                  onPress={() => setIndex((i) => Math.min(media.length - 1, (i ?? 0) + 1))}
                />
              </>
            )}
            <Button title={t('media.close')} onPress={() => setIndex(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  tile: { width: '48.5%', aspectRatio: 1, borderRadius: theme.radius.md, overflow: 'hidden' },
  tileWide: { width: '100%', aspectRatio: 16 / 9 },
  fill: { width: '100%', height: '100%' },
  video: { backgroundColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' },
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  full: { width: '100%', height: '70%' },
  controls: {
    flexDirection: 'row',
    gap: theme.spacing.md,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
});
