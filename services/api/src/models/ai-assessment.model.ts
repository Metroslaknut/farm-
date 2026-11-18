import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

/**
 * One assessment. The calculated `result` and the minimised `inputs` it was calculated from are written once and never
 * edited: only the owner's `review` and the dismissal of individual recommendations change afterwards.
 */
export interface AiAssessmentAttrs {
  _id: Types.ObjectId;
  farmId: Types.ObjectId;
  animalId: Types.ObjectId;
  animalCode: string;
  requestedBy: Types.ObjectId;
  assessmentDate: Date;
  animalTypeKey: string;
  animalTypeName: string;
  sex: string;
  /** Everything calculated (factors, price range, proceeds, costs, growth, health, warnings, confidence). */
  result: Record<string, unknown>;
  /** The data the calculation (and, if used, the AI) was given: numbers and enumerations only, no names or free text. */
  inputs: Record<string, unknown>;
  engineVersion: string;
  criteriaRef?: {
    id: Types.ObjectId;
    key: string;
    version: number;
    validated: boolean;
    source: string;
  } | null;
  narrative: Record<string, unknown>;
  modelVersion: string;
  recommendations: {
    id: string;
    code: string;
    text: string;
    dismissedAt?: Date | null;
    dismissedBy?: Types.ObjectId | null;
  }[];
  review: {
    status: 'pending' | 'accepted' | 'dismissed';
    by?: Types.ObjectId | null;
    at?: Date | null;
    note?: string | null;
    history: { status: string; by: Types.ObjectId; at: Date; note?: string | null }[];
  };
  createdAt: Date;
}

const schema = new Schema<AiAssessmentAttrs>(
  {
    farmId: { type: Schema.Types.ObjectId, required: true, ref: 'Farm' },
    animalId: { type: Schema.Types.ObjectId, required: true, ref: 'Animal' },
    animalCode: { type: String, required: true },
    requestedBy: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    assessmentDate: { type: Date, required: true },
    animalTypeKey: { type: String, required: true },
    animalTypeName: { type: String, required: true },
    sex: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    inputs: { type: Schema.Types.Mixed, required: true },
    engineVersion: { type: String, required: true },
    criteriaRef: { type: Schema.Types.Mixed, default: null },
    narrative: { type: Schema.Types.Mixed, required: true },
    modelVersion: { type: String, required: true },
    recommendations: { type: Schema.Types.Mixed, default: [] },
    review: { type: Schema.Types.Mixed, default: () => ({ status: 'pending', history: [] }) },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'ai_assessments',
    minimize: false,
  },
);
schema.index({ farmId: 1, animalId: 1, assessmentDate: -1, _id: -1 });
schema.index({ farmId: 1, 'review.status': 1, assessmentDate: -1 });
schema.index({ farmId: 1, assessmentDate: 1 });

export type AiAssessmentDoc = HydratedDocument<AiAssessmentAttrs>;
export const AiAssessment = model<AiAssessmentAttrs>('AiAssessment', schema);
