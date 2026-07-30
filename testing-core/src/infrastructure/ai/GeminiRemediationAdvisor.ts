import type { RemediationFailureReason, SuggestFixRequest, SuggestInsightsRequest } from '../../../../shared/types.js';

// On-demand LLM generation via Google Gemini. Every failure path resolves to a
// classified reason instead of a bare null, so the caller can fall back to the
// deterministic knowledge-base output AND report why the model was skipped.

const MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-lite-latest';
// Reasoning-capable flash models routinely spend 6-12s on thinking tokens before the
// first byte; anything under ~20s aborts a healthy call and looks like an outage.
const TIMEOUT_MS = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? '', 10) || 30_000;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; reason: RemediationFailureReason };

type Candidate = { content?: { parts?: Array<{ text?: string }> }; finishReason?: string };
type GeminiPayload = { candidates?: Candidate[]; promptFeedback?: { blockReason?: string }; error?: { message?: string; status?: string } };

function extractText(payload: GeminiPayload): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  return (parts?.map((p) => p?.text ?? '').join('') ?? '').trim();
}

// HTTP status -> operator-meaningful cause. 400 is split because Google reports an
// invalid/expired key as 400 INVALID_ARGUMENT, not 401.
function classifyStatus(status: number, body: GeminiPayload): RemediationFailureReason {
  if (status === 400) return /api key/i.test(body?.error?.message ?? '') ? 'auth' : 'bad_request';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model_unavailable';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'provider_error';
  return 'provider_error';
}

// Never let a provider message reach a log line verbatim without scrubbing the key.
function redact(text: string, key: string): string {
  return key ? text.split(key).join('***') : text;
}

async function callGemini(prompt: string, jsonOutput = false): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    console.error('[RemediationAdvisor] GEMINI_API_KEY is not set — skipping model, using deterministic output.');
    return { ok: false, reason: 'not_configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      // Key travels in a header, not the query string, so it never lands in a URL log.
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(jsonOutput ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
      }),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => ({}))) as GeminiPayload;
    if (!res.ok) {
      const reason = classifyStatus(res.status, body);
      console.error(
        `[RemediationAdvisor] Gemini ${res.status} (${reason}) model=${MODEL} after ${Date.now() - startedAt}ms:`,
        redact(body?.error?.message ?? '(no message)', key),
      );
      return { ok: false, reason };
    }

    const text = extractText(body);
    if (!text) {
      const finish = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? 'unknown';
      console.error(`[RemediationAdvisor] Gemini returned no text (finishReason=${finish}) model=${MODEL} after ${Date.now() - startedAt}ms`);
      return { ok: false, reason: 'empty_response' };
    }
    return { ok: true, text };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const reason: RemediationFailureReason = aborted ? 'timeout' : 'network';
    const detail = aborted ? `exceeded ${TIMEOUT_MS}ms` : error instanceof Error ? redact(error.message, key) : String(error);
    console.error(`[RemediationAdvisor] Gemini call failed (${reason}) model=${MODEL} after ${Date.now() - startedAt}ms:`, detail);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

// Compact, single fenced-context prompt — only the fields that were actually captured.
function buildFixPrompt(req: SuggestFixRequest): string {
  const facts = [
    req.bugClass && `Bug class: ${req.bugClass}`,
    req.severity && `Severity: ${req.severity}`,
    req.cwe && `CWE: ${req.cwe}`,
    req.message && `Error message: ${req.message}`,
    req.elementLabel && `Culprit control: ${req.elementLabel}`,
    req.payloadUsed && `Payload used: ${req.payloadUsed}`,
    req.stackTrace && `Stack trace:\n${req.stackTrace}`,
    req.reproductionSteps?.length && `Reproduction:\n${req.reproductionSteps.join('\n')}`,
  ].filter(Boolean).join('\n');
  return [
    'You are a senior engineer triaging an automated exploratory-testing finding for a web SPA.',
    'Give a concrete, actionable remediation for the fault below.',
    'Respond with 3-5 short numbered steps, code-oriented, no preamble, under 120 words.',
    '',
    facts,
  ].join('\n');
}

export async function generateRemediation(req: SuggestFixRequest): Promise<GeminiResult> {
  return callGemini(buildFixPrompt(req));
}

// Strip ```json fences the model sometimes wraps around structured output.
function parseJsonBlock(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function buildInsightsPrompt(req: SuggestInsightsRequest): string {
  const findings = (req.findings ?? [])
    .map((f, i) => `${i + 1}. [${(f.severity ?? 'MEDIUM').toUpperCase()}] ${f.bugClass ?? 'Issue'}${f.elementLabel ? ` on "${f.elementLabel}"` : ''}: ${f.message ?? ''}`)
    .join('\n');
  return [
    'You are a principal engineer summarizing an automated exploratory-testing run of a web SPA.',
    'From the findings below, produce a session-level root-cause narrative and prioritized fixes.',
    'Respond ONLY with minified JSON: {"rootCause": string, "recommendations": string[]}.',
    'rootCause: 1-2 sentences. recommendations: 3-5 short actionable items. No markdown, no prose outside JSON.',
    '',
    `Risk level: ${req.riskLevel ?? 'unknown'}`,
    `Findings (${req.findings?.length ?? 0}):`,
    findings || '(none)',
  ].join('\n');
}

export type InsightsResult =
  | { ok: true; rootCause: string; recommendations: string[] }
  | { ok: false; reason: RemediationFailureReason };

export async function generateInsights(req: SuggestInsightsRequest): Promise<InsightsResult> {
  const call = await callGemini(buildInsightsPrompt(req), true);
  if (!call.ok) return call;

  const parsed = parseJsonBlock(call.text) as { rootCause?: unknown; recommendations?: unknown } | null;
  const rootCause = typeof parsed?.rootCause === 'string' ? parsed.rootCause.trim() : '';
  const recommendations = Array.isArray(parsed?.recommendations)
    ? parsed.recommendations.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : [];
  if (!rootCause && recommendations.length === 0) {
    console.error(`[RemediationAdvisor] Gemini output was not usable insights JSON (${call.text.length} chars) model=${MODEL}`);
    return { ok: false, reason: 'invalid_response' };
  }
  return { ok: true, rootCause, recommendations };
}
