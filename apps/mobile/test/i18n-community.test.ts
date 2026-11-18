import { describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n/locale';
import catalog from '../src/i18n/messages/community';
import {
  communityValidationText,
  validatePostDraft,
  visibilityOptions,
  type PostDraft,
} from '../src/lib/community';

const draft = (over: Partial<PostDraft> = {}): PostDraft => ({
  body: 'Hello',
  visibility: 'public',
  media: [],
  ...over,
});

describe('community i18n', () => {
  it('Thai and English catalogs have the same keys', () => {
    expect(Object.keys(catalog.th).sort()).toEqual(Object.keys(catalog.en).sort());
  });

  it('visibility options follow the current language', () => {
    expect(visibilityOptions().map((o) => o.label)).toEqual(['Everyone', 'Followers', 'Only me']);
    setLocale('th');
    expect(visibilityOptions().map((o) => o.label)).toEqual(['ทุกคน', 'ผู้ติดตาม', 'เฉพาะฉัน']);
  });

  it('post draft errors are Thai in Thai mode and unchanged in English', () => {
    const empty = draft({ body: '  ' });
    expect(validatePostDraft(empty)['body']).toBe('Write something or attach a photo or video');
    setLocale('th');
    expect(validatePostDraft(empty)['body']).toBe('เขียนข้อความ หรือแนบรูปภาพหรือวิดีโอ');
    const http = validatePostDraft(
      draft({ media: [{ kind: 'image', url: 'http://cdn.example.test/a.jpg', caption: '' }] }),
    );
    expect(http['media.0.url']).toBe('ลิงก์ต้องขึ้นต้นด้วย https://');
    expect(communityValidationText('Write a comment')).toBe('กรุณาเขียนความคิดเห็น');
  });
});
