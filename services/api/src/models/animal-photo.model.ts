import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * A photo uploaded from the user's device for one animal. The bytes live here (browsers shrink photos before upload,
 * so a document stays far below MongoDB's 16 MB limit) and the animal's `media` entry points at
 * `/api/v1/animal-photos/<key>`. The random `key` is the capability that lets an <img> tag load it without a token.
 * With PHOTO_STORAGE=r2 the bytes live in the bucket instead (`storage: 'r2'`, no `data`) and this document keeps the
 * ownership/metadata. Documents written before `storage` existed are database-stored (the default).
 */
export interface AnimalPhotoAttrs {
  _id: Types.ObjectId;
  key: string;
  farmId: Types.ObjectId;
  animalId: Types.ObjectId;
  /** Set when the photo was uploaded for a breeding record (it is then filed under the record's dam). */
  breedingRecordId?: Types.ObjectId | null;
  uploadedBy: Types.ObjectId;
  mimeType: string;
  sizeBytes: number;
  storage: 'database' | 'r2';
  /** The bytes, for `storage: 'database'` only. */
  data?: Buffer;
  createdAt: Date;
}

const schema = new Schema<AnimalPhotoAttrs>(
  {
    key: { type: String, required: true, unique: true },
    farmId: { type: Schema.Types.ObjectId, required: true, index: true },
    animalId: { type: Schema.Types.ObjectId, required: true, index: true },
    breedingRecordId: { type: Schema.Types.ObjectId, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    storage: { type: String, enum: ['database', 'r2'], default: 'database' },
    data: { type: Buffer },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'animal_photos' },
);

export type AnimalPhotoDoc = HydratedDocument<AnimalPhotoAttrs>;
export const AnimalPhoto = model<AnimalPhotoAttrs>('AnimalPhoto', schema);
