import type { SuggestFixRequest, SuggestInsightsRequest } from '../../../../shared/types.js';

// On-demand LLM generation via Google Gemini. Best-effort: any missing key,
// timeout, transport error, or empty output resolves to null so the caller can
// fall back to the deterministic knowledge-base output.

const MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest';
const TIMEOUT_MS = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? '', 10) || 8000;
const ENDPOINT = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;

function extractText(payload: unknown): string {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts;
  return (parts?.map((p) => p?.text ?? '').join('') ?? '').trim();
}

// Single low-level call — returns the model's text, or null on any failure.
async function callGemini(prompt: string): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error('[RemediationAdvisor] Gemini responded', res.status);
      return null;
    }
    const text = extractText(await res.json());
    return text.length > 0 ? text : null;
  } catch (error) {
    console.error('[RemediationAdvisor] Gemini call failed:', error instanceof Error ? error.message : error);
    return null;
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

export async function generateRemediation(req: SuggestFixRequest): Promise<string | null> {
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

// Returns a session-level insight, or null on any failure / malformed output.
export async function generateInsights(
  req: SuggestInsightsRequest,
): Promise<{ rootCause: string; recommendations: string[] } | null> {
  const text = await callGemini(buildInsightsPrompt(req));
  if (!text) return null;

  const parsed = parseJsonBlock(text) as { rootCause?: unknown; recommendations?: unknown } | null;
  const rootCause = typeof parsed?.rootCause === 'string' ? parsed.rootCause.trim() : '';
  const recommendations = Array.isArray(parsed?.recommendations)
    ? parsed!.recommendations.filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
    : [];
  if (!rootCause && recommendations.length === 0) return null;
  return { rootCause, recommendations };
}
