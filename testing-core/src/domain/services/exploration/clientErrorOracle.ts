import type { Page } from 'playwright';
import { matchesCategory } from '../../../bugs/knowledgeBase/signalPatterns.js';

// Client-rendered error-view oracle (audit P3-17).
//
// The hard error signal is `httpStatus >= 400`, taken from the main-frame DOCUMENT
// response. In a client-routed SPA — the entire target class of this product — a
// route change issues no document request, so the status is null for nearly every
// state and the signal effectively never fires after the first load. A client
// rendered "Not found" / "Something went wrong" view served under HTTP 200 was
// therefore admitted to the graph as an ordinary state: explored, counted as
// coverage, and never raising the broken-route defect the navigation finder exists
// to produce.
//
// This oracle depends on no transport status at all.

/** A rendered view judged to be an error page, with the evidence that decided it. */
export interface ClientErrorVerdict {
  isErrorView: boolean;
  signal: string;
}

const NOT_AN_ERROR: ClientErrorVerdict = { isErrorView: false, signal: '' };

// An error view is characteristically SHORT and control-poor. Requiring that as
// well as a matching phrase keeps a normal, populated page that merely contains the
// words "not found" (a search result, a help article, an empty-state row in a table)
// from being excluded from the graph.
const MAX_ERROR_VIEW_TEXT = 600;
const MAX_ERROR_VIEW_CONTROLS = 4;

// Sampled from the rendered body; bounded so a huge page costs nothing to check.
const TEXT_SAMPLE_LIMIT = 4000;

// Node-side ceiling on the sample evaluate. A wedged renderer main thread (heavy media
// decode, render loop) leaves an un-timeouted page.evaluate parked forever, freezing the
// step loop past the timebox. On expiry we abandon the sample and treat the view as
// non-error rather than parking the iteration. Env-tunable.
function sampleEvalDeadlineMs(): number {
  const n = Number.parseInt(process.env.BUGSAFARI_CLIENT_ERROR_EVAL_DEADLINE_MS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

interface ViewSample {
  text: string;
  textLength: number;
  controlCount: number;
}

/**
 * Judge the CURRENT rendered view. Returns a positive verdict only when an
 * error-template phrase is present AND the view is sparse enough to be an error
 * page rather than a populated screen that happens to mention one.
 */
export async function detectClientErrorView(page: Page): Promise<ClientErrorVerdict> {
  const sample = await sampleView(page);
  if (!sample) return NOT_AN_ERROR;

  if (sample.textLength > MAX_ERROR_VIEW_TEXT) return NOT_AN_ERROR;
  if (sample.controlCount > MAX_ERROR_VIEW_CONTROLS) return NOT_AN_ERROR;

  for (const category of ['DEAD_END', 'SERVER_ERROR', 'COMPONENT_FAIL'] as const) {
    if (matchesCategory(category, sample.text)) {
      return { isErrorView: true, signal: `${category}: ${sample.text.slice(0, 120).trim()}` };
    }
  }
  return NOT_AN_ERROR;
}

async function sampleView(page: Page): Promise<ViewSample | null> {
  const work = page
    .evaluate((limit: number) => {
      const body = document.body;
      if (!body) return null;
      const raw = (body.innerText || '').replace(/\s+/g, ' ').trim();
      return {
        text: raw.slice(0, limit),
        textLength: raw.length,
        controlCount: document.querySelectorAll('button, a[href], input, select, textarea').length,
      };
    }, TEXT_SAMPLE_LIMIT)
    .catch(() => null);
  // Bound Node-side: a wedged renderer never resolves the evaluate. On timeout the
  // abandoned work resolves to null (its late settle is swallowed by the .catch above).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), sampleEvalDeadlineMs());
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
