import { Schema, model, Types, Document } from 'mongoose';

/**
 * Screenshot types captured during autonomous testing
 */
export enum ForensicScreenshotType {
  INITIAL = 'INITIAL',
  FAILURE = 'FAILURE',
  FINAL = 'FINAL',
  CRITICAL_EVENT = 'CRITICAL_EVENT',
  JS_EXCEPTION = 'JS_EXCEPTION',
  API_FAILURE = 'API_FAILURE',
  NAVIGATION_FAILURE = 'NAVIGATION_FAILURE',
}

const forensicScreenshotSchema = new Schema(
  {
    forensicRunId: {
      type: Types.ObjectId,
      ref: 'SafariSession',
      required: [true, 'Forensic run ID is required'],
      index: true,
    },
    screenshotType: {
      type: String,
      required: [true, 'Screenshot type is required'],
      enum: Object.values(ForensicScreenshotType),
      index: true,
    },
    // Base64 encoded image data (stored directly in MongoDB for simplicity)
    // For larger deployments, this could be stored in GridFS or external storage
    imageData: {
      type: String,
      required: [true, 'Image data is required'],
    },
    // Optional file path if stored on disk instead of in DB
    filePath: {
      type: String,
      required: false,
      default: null,
    },
    // Page URL when screenshot was taken
    url: {
      type: String,
      required: false,
      default: null,
    },
    // Error message associated with this screenshot (if failure type)
    errorMessage: {
      type: String,
      required: false,
      default: null,
    },
    // Step number in the exploration when screenshot was taken
    stepNumber: {
      type: Number,
      required: false,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'forensic_screenshots',
  }
);

// Compound indexes for efficient querying
forensicScreenshotSchema.index({ forensicRunId: 1, screenshotType: 1 });
forensicScreenshotSchema.index({ forensicRunId: 1, createdAt: -1 });

export interface IForensicScreenshot extends Document {
  forensicRunId: Types.ObjectId;
  screenshotType: ForensicScreenshotType;
  imageData: string;
  filePath?: string;
  url?: string;
  errorMessage?: string;
  stepNumber?: number;
  createdAt: Date;
  updatedAt: Date;
}

export const ForensicScreenshotModel = model<IForensicScreenshot>('ForensicScreenshot', forensicScreenshotSchema);
