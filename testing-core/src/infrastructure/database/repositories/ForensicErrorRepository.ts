import { Types } from 'mongoose';
import {
  ForensicErrorModel,
  IForensicError,
  ForensicErrorType,
  ForensicErrorSeverity,
} from '../models/ForensicErrorModel.js';
import { MAX_FORENSIC_ROWS } from '../queryLimits.js';

export interface CreateForensicErrorParams {
  forensicRunId: string | Types.ObjectId;
  type: ForensicErrorType;
  severity: ForensicErrorSeverity;
  message: string;
  stackTrace?: string;
  url?: string;
  endpoint?: string;
  method?: string;
  statusCode?: number;
  responseText?: string;
  filename?: string;
  lineNumber?: number;
  columnNumber?: number;
  selector?: string;
  action?: string;
  // Knowledge-base attribution — the classifier output the report renders.
  bugClass?: string;
  scenario?: string;
  cwe?: string;
}

// Free-text ceilings — target responses/messages can carry unbounded payloads.
const MAX_RESPONSE_TEXT_LEN = 2000;
const MAX_MESSAGE_LEN = 4000;
const MAX_STACK_LEN = 8000;

// Redact obvious secrets before persist — tested-app responses may carry tokens/PII.
function redactSecrets(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9._-]{10,}/g, '[REDACTED_JWT]')
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|client[_-]?secret)"?\s*[:=]\s*"?)[^"\s,&}]+/gi, '$1[REDACTED]');
}

// Redact then cap a free-text field; undefined passes through untouched.
function capText(value: string | undefined, max: number): string | undefined {
  if (value == null) return value;
  const redacted = redactSecrets(value);
  return redacted.length > max ? `${redacted.slice(0, max)}…[truncated ${redacted.length - max} chars]` : redacted;
}

// Single persist-boundary sanitizer — the only place documents are shaped for storage.
function toDocument(params: CreateForensicErrorParams): Record<string, unknown> {
  return {
    forensicRunId: new Types.ObjectId(params.forensicRunId),
    type: params.type,
    severity: params.severity,
    message: capText(params.message, MAX_MESSAGE_LEN),
    stackTrace: capText(params.stackTrace, MAX_STACK_LEN),
    url: params.url,
    endpoint: params.endpoint,
    method: params.method,
    statusCode: params.statusCode,
    responseText: capText(params.responseText, MAX_RESPONSE_TEXT_LEN),
    filename: params.filename,
    lineNumber: params.lineNumber,
    columnNumber: params.columnNumber,
    selector: params.selector,
    action: params.action,
    bugClass: params.bugClass,
    scenario: params.scenario,
    cwe: params.cwe,
  };
}

export class ForensicErrorRepository {
  /**
   * Create a new forensic error record
   */
  async create(params: CreateForensicErrorParams): Promise<IForensicError> {
    const error = new ForensicErrorModel(toDocument(params));
    return error.save();
  }

  /**
   * Create multiple forensic errors in batch
   */
  async createMany(errors: CreateForensicErrorParams[]): Promise<IForensicError[]> {
    const documents = errors.map(toDocument);
    return ForensicErrorModel.insertMany(documents) as unknown as Promise<IForensicError[]>;
  }

  /**
   * Find all errors for a forensic run
   */
  async findByRunId(forensicRunId: string | Types.ObjectId): Promise<IForensicError[]> {
    return ForensicErrorModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
    })
      .sort({ createdAt: -1 })
      .limit(MAX_FORENSIC_ROWS)
      .lean<IForensicError[]>()
      .exec();
  }

  /**
   * Find one page of errors for a forensic run — same sort as findByRunId, but
   * bounded by an explicit offset/limit for the paginated report path.
   */
  async findPageByRunId(
    forensicRunId: string | Types.ObjectId,
    limit: number,
    offset: number,
  ): Promise<IForensicError[]> {
    return ForensicErrorModel.find({
      forensicRunId: new Types.ObjectId(forensicRunId),
    })
      .sort({ createdAt: -1 })
      .skip(Math.max(0, offset))
      .limit(Math.min(Math.max(1, limit), MAX_FORENSIC_ROWS))
      .lean<IForensicError[]>()
      .exec();
  }

  /** Total error rows for a forensic run (drives pagination metadata). */
  async countByRunId(forensicRunId: string | Types.ObjectId): Promise<number> {
    return ForensicErrorModel.countDocuments({
      forensicRunId: new Types.ObjectId(forensicRunId),
    }).exec();
  }

  /**
   * Get error count by type for a forensic run
   */
  async getCountByType(forensicRunId: string | Types.ObjectId): Promise<Record<string, number>> {
    const results = await ForensicErrorModel.aggregate([
      {
        $match: { forensicRunId: new Types.ObjectId(forensicRunId) },
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap: Record<string, number> = {};
    for (const result of results) {
      countMap[result._id] = result.count;
    }
    return countMap;
  }

  // Cascade deletes live in retentionReaper's CHILD_COLLECTIONS table — the one
  // mechanism shared by the on-demand delete and the orphan sweep. A per-repo
  // deleteByRunId would be a second place to forget a collection.
}

// Export singleton instance
export const forensicErrorRepository = new ForensicErrorRepository();
