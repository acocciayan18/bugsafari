# Forensic Report — Content Improvement Plan (not design/layout)

Doc only. No implementation this pass. Scope: what data the report contains and says, not how it looks (see `based-on-the-bugsafari-reflective-kazoo` plan for display/layout — severity badges, route grouping, glossary, checklist UI).

## Ground truth check (current report content)

- Suggested fix already exists: `SuggestedFixBlock` (`ForensicCardKit.tsx:125`) renders `bug.advice`, sourced from `FaultClassifier.ts:214` → `definition.remediation` in `bugCatalog.ts`.
- `remediation` is a **static, per-BugClass template** (12 bug classes total, one canned snippet each) — not generated per finding. Same XSS advice text shows for every XSS finding regardless of the actual selector/route/markup involved.
- Reproduction steps already exist (`ReproductionChecklist`, `ForensicReport.tsx:559`).
- Executive summary already exists (`ForensicReport.tsx:90`), no severity breakdown line yet (blocked on severity-threading gap, tracked in the display plan).
- No infra-status subsystem (backend/CORS/DB health) anywhere in `testing-core`. Not a report-content gap — there's no data source to report from. Still out of scope.
- No screenshot capture (`registerRoutes.ts:787` hardcodes `screenshots: []`, deliberate). Still out of scope.

## Content gaps worth closing

1. **Per-finding severity breakdown in executive summary** — count of Critical/High/Medium/Low. Data exists once severity-threading (display plan, backend change 1) lands; this is the content half of that same fix.
2. **Routes-affected summary line** — "N routes tested, M findings across K routes." Data exists once `url` threading (display plan, backend change 2) lands.
3. **"Why unreported" note for filtered-out candidates** — pipeline already computes `reason` on every candidate (`VerificationPipeline.ts:125`, e.g. "Automation-driver artifact", "Transport/environment failure") but rejected candidates never reach the report at all (`report: false` in `evaluate()`). Worth surfacing as a one-line "X candidates filtered as non-app noise (Playwright/network/browser artifacts)" line in the summary — builds trust that the low finding count isn't the tool missing things.
4. **Per-finding root-cause line** — `attribution.reason` (from `classifyFaultOrigin`) already exists on the verdict but isn't currently threaded into what the finding card renders. Cheap, already-computed, just needs the same threading as severity.
5. **Suggested-fix content depth** — see below, biggest content gap.

## Suggested-fix content: static template vs API-generated

Current: `advice` is one hardcoded string per `BugClass` (12 total), same text for every instance of that class. Useful as a baseline but generic — doesn't reference the actual file/selector/message of the specific finding.

**Proposed addition (idea only, not implemented): an option to have an API call generate the suggested fix instead of / in addition to the static template.**

- Feed the model the concrete finding: `bugClass`, `message`, `selector`, `url`, surrounding DOM snapshot if captured, stack trace if present.
- Output: a fix tailored to that instance (real selector name, real route) rather than the generic template.
- Positioning: **additive, not a replacement.** Static `bugCatalog.ts` remediation stays as the reliable, zero-latency, zero-cost fallback (works offline, no API key, no rate limit, no hallucination risk). API-generated fix is an opt-in "Generate tailored fix" action per finding — user-triggered, not automatic on every report render, to control cost/latency.
- Needs before implementable: which API/model, cost per report (12+ findings × tokens), latency budget in report render path, and whether it runs server-side (`testing-core`, keeps API key off client) or is out of scope entirely for this pass. Flagging as a real gap, not scoping it yet — needs your call on provider/budget before any code.

## Explicitly not changing this pass

- Layout/design of any of the above (tracked separately in the display-improvement plan).
- Screenshot proof, infra status cards — no backing subsystem, out of scope per earlier discussion.
- Markdown/PDF export — deferred, unrelated to content itself.
- No code touched yet — this file is the plan only, per your instruction.
