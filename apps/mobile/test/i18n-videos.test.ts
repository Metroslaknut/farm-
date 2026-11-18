import { describe, expect, it } from 'vitest';
import { setLocale } from '../src/i18n/locale';
import {
  processingStateInline,
  processingStateLabel,
  videoFailureText,
  videoFileError,
} from '../src/lib/pickedVideo';

const rules = { maxUploadBytes: 2 * 1024 * 1024, mimeTypes: ['video/mp4'] };
const failure = { code: 'too_long', message: 'The video is longer than 3 minutes.' };

describe('video helpers in English (unchanged text)', () => {
  it('keeps the shared validator messages', () => {
    expect(videoFileError({ name: 'a.mp4', type: 'video/mp4', size: 10 }, rules)).toBeUndefined();
    expect(videoFileError({ name: 'a.gif', type: 'image/gif', size: 10 }, rules)).toBe(
      'Choose an MP4, MOV, M4V or WebM video.',
    );
    expect(videoFileError({ name: 'a.mp4', type: 'video/mp4', size: 0 }, rules)).toBe(
      'The file is empty.',
    );
    expect(videoFileError({ name: 'a.mp4', type: 'video/mp4', size: 9e9 }, rules)).toBe(
      'The video is too large (max 2 MB).',
    );
  });
  it('labels states like humanize and keeps server failure text', () => {
    expect(processingStateLabel('pending_upload')).toBe('Pending upload');
    expect(processingStateLabel('weird_state')).toBe('Weird state');
    expect(processingStateInline('pending_upload')).toBe('pending upload');
    expect(videoFailureText(failure)).toBe(failure.message);
  });
});

describe('video helpers in Thai', () => {
  it('translates file checks, states and failures', () => {
    setLocale('th');
    expect(videoFileError({ name: 'a.gif', type: 'image/gif', size: 10 }, rules)).toBe(
      'กรุณาเลือกวิดีโอ MP4, MOV, M4V หรือ WebM',
    );
    expect(videoFileError({ name: 'a.mp4', type: 'video/mp4', size: 9e9 }, rules)).toBe(
      'วิดีโอมีขนาดใหญ่เกินไป (สูงสุด 2 MB)',
    );
    expect(processingStateLabel('processing')).toBe('กำลังประมวลผล');
    expect(videoFailureText(failure)).toBe('วิดีโอยาวเกินกำหนด');
    expect(videoFailureText({ code: 'something_new', message: 'x' })).toBe(
      'ประมวลผลวิดีโอไม่สำเร็จ',
    );
    expect(videoFailureText({ code: null, message: 'Server text' })).toBe('Server text');
  });
});
