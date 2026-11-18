import { Schema, model, type Types } from 'mongoose';

export interface SettingAttrs {
  _id: Types.ObjectId;
  key: string;
  value: string | number | boolean;
  updatedBy?: Types.ObjectId | null;
  updatedAt: Date;
}
const schema = new Schema<SettingAttrs>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true }, collection: 'settings' },
);
export const Setting = model<SettingAttrs>('Setting', schema);
