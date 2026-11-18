import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * A photo uploaded from the user's device for one animal. The bytes live here (browsers shrink photos before upload,
 * so a document stays far below MongoDB's 16 MB limit) and the animal's `media` entry points at
 * `/api/v1/animal-photos/<key>`. The random `key` is the capability that lets an <img> tag load it without a token.
 */
export interface AnimalPhotoAttrs {
  _id: Types.ObjectId;
  key: string;
  farmId: Types.ObjectId;
  animalId: Types.ObjectId;
  uploadedBy: Types.ObjectId;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
  createdAt: Date;
}

const schema = new Schema<AnimalPhotoAttrs>(
  {
    key: { type: String, required: true, unique: true },
    farmId: { type: Schema.Types.ObjectId, required: true, index: true },
    animalId: { type: Schema.Types.ObjectId, required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    data: { type: Buffer, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'animal_photos' },
);

export type AnimalPhotoDoc = HydratedDocument<AnimalPhotoAttrs>;
export const AnimalPhoto = model<AnimalPhotoAttrs>('AnimalPhoto', schema);
