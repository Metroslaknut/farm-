import { Schema, model, type Types } from 'mongoose';

/** One row per (video, viewer): when the viewer's last counted view happened. This is what deduplicates views. */
export interface VideoMetricAttrs {
  _id: Types.ObjectId;
  videoId: Types.ObjectId;
  viewerId: Types.ObjectId;
  kind: 'view';
  lastCountedAt: Date;
  count: number;
}

const schema = new Schema<VideoMetricAttrs>(
  {
    videoId: { type: Schema.Types.ObjectId, required: true },
    viewerId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['view'], default: 'view' },
    lastCountedAt: { type: Date, required: true },
    count: { type: Number, default: 1 },
  },
  { collection: 'video_metrics' },
);
schema.index({ videoId: 1, viewerId: 1, kind: 1 }, { unique: true });

export const VideoMetric = model<VideoMetricAttrs>('VideoMetric', schema);
