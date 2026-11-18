import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { api } from '../../api';
import { useFarmsT } from './labels';

/** A photo chosen on this device, already shrunk, waiting to be uploaded. */
export interface PendingPhoto {
  id: string;
  blob: Blob;
  preview: string;
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIDE = 1600;
/** Same cap as the API (an animal holds at most 20 files, photos and documents together). */
export const MAX_PHOTOS = 20;

/** Scale a photo down to at most MAX_SIDE px and re-encode it as JPEG; the original is kept if that fails. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Upload photos one by one (the API takes one image per request). Stops at the first failure. */
export async function uploadPhotos(
  farmId: string,
  animalId: string,
  photos: PendingPhoto[],
  onProgress?: (done: number) => void,
): Promise<void> {
  for (const [i, p] of photos.entries()) {
    onProgress?.(i + 1);
    await api.request('POST', `/farms/${farmId}/animals/${animalId}/photos`, { body: p.blob });
  }
}

/** Choose photos from the device (file picker or drag and drop), with previews. */
export function PhotoPicker({
  photos,
  onChange,
  max = MAX_PHOTOS,
  disabled,
}: {
  photos: PendingPhoto[];
  onChange: (photos: PendingPhoto[]) => void;
  max?: number;
  disabled?: boolean;
}) {
  const t = useFarmsT();
  const inputId = useId();
  const [error, setError] = useState<string>();
  const [over, setOver] = useState(false);

  // Release the preview URLs when the picker goes away.
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  });
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.preview)), []);

  const add = async (files: FileList | null) => {
    if (!files) return;
    setError(undefined);
    const list = [...files];
    const bad = list.find((f) => !ACCEPTED.includes(f.type));
    if (bad) setError(t('photos.notImage', { name: bad.name }));
    const room = max - photos.length;
    const good = list.filter((f) => ACCEPTED.includes(f.type));
    if (good.length > room) setError(t('photos.tooMany', { max }));
    const added = await Promise.all(
      good.slice(0, Math.max(0, room)).map(async (f) => {
        const blob = await shrink(f);
        return { id: crypto.randomUUID(), blob, preview: URL.createObjectURL(blob) };
      }),
    );
    if (added.length) onChange([...photos, ...added]);
  };

  const remove = (id: string) => {
    const p = photos.find((x) => x.id === id);
    if (p) URL.revokeObjectURL(p.preview);
    onChange(photos.filter((x) => x.id !== id));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!disabled) void add(e.dataTransfer.files);
  };

  return (
    <div>
      {photos.length > 0 && (
        <ul className="fd-photos">
          {photos.map((p, i) => (
            <li key={p.id}>
              <img src={p.preview} alt={t('photos.photo', { n: i + 1 })} />
              {!disabled && (
                <button
                  type="button"
                  aria-label={t('photos.remove', { n: i + 1 })}
                  onClick={() => remove(p.id)}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {photos.length < max && (
        <label
          htmlFor={inputId}
          className={`fd-dropzone${over ? ' fd-dropzone--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <input
            id={inputId}
            type="file"
            accept={ACCEPTED.join(',')}
            multiple
            disabled={disabled}
            onChange={(e) => {
              void add(e.target.files);
              e.target.value = '';
            }}
          />
          <strong>{t('photos.choose')}</strong>
          <span className="ds-field__hint">{t('photos.dropHint')}</span>
        </label>
      )}
      {error && (
        <p role="alert" className="ds-field__error">
          {error}
        </p>
      )}
    </div>
  );
}
