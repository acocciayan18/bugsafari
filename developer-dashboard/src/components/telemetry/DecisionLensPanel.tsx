// ═══════════════════════════════════════════════════════════════
// DecisionLensPanel.tsx - GLASS-BOX ML DECISION EXPLAINABILITY
// ═══════════════════════════════════════════════════════════════
// Renders the exact per-feature attribution behind each autonomous target pick.
// The engine's risk model is a single-layer perceptron, so the decision logit is
// linear (z = bias + Σ wᵢxᵢ) and every feature's contribution is EXACTLY wᵢ×xᵢ —
// an exact decomposition shown here as a diverging waterfall, plus the runner-up
// counterfactual and how far online learning has drifted each weight from its prior.

import { memo, useMemo, useState } from 'react';
import type { DecisionRationale, FeatureContribution } from '../../types';

interface DecisionLensPanelProps {
  rationales: DecisionRationale[];
}

// Stable identity for a rationale across the sliding buffer (index is not stable).
const keyOf = (r: DecisionRationale): string => `${r.step}-${r.timestamp}-${r.selector}`;

const signed = (n: number, dp = 3): string => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}`;

const roleTone: Record<string, string> = {
  LOGIN: 'bg-purple-50 text-purple-700 border-purple-200',
  DESTRUCTIVE: 'bg-red-50 text-red-700 border-red-200',
  SUBMIT: 'bg-blue-50 text-blue-700 border-blue-200',
  SEARCH: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  NAVIGATE: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  INPUT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCEL: 'bg-amber-50 text-amber-700 border-amber-200',
  UNKNOWN: 'bg-gray-100 text-gray-600 border-gray-200',
};

// ── One diverging attribution row: label · bar centered at 0 · exact term ──
const ContributionRow = memo(function ContributionRow({
  contribution,
  maxAbs,
}: {
  contribution: FeatureContribution;
  maxAbs: number;
}) {
  const positive = contribution.contribution >= 0;
  const widthPct = maxAbs > 0 ? (Math.abs(contribution.contribution) / maxAbs) * 50 : 0;
  const drifted = Math.abs(contribution.drift) >= 0.005;

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="w-32 shrink-0 truncate text-[11px] text-gray-600" title={contribution.label}>
        {contribution.label}
      </div>

      {/* Diverging bar: zero at the centre; green extends right, red extends left. */}
      <div className="relative h-3 flex-1 rounded bg-gray-100">
        <div className="absolute left-1/2 top-0 h-full w-px bg-gray-300" />
        <div
          className={`absolute top-0 h-full rounded ${positive ? 'bg-emerald-400' : 'bg-red-400'}`}
          style={
            positive
              ? { left: '50%', width: `${widthPct}%` }
              : { left: `${50 - widthPct}%`, width: `${widthPct}%` }
          }
        />
      </div>

      <div className="flex w-28 shrink-0 items-center justify-end gap-1.5">
        <span className={`font-mono text-[11px] font-semibold ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
          {signed(contribution.contribution)}
        </span>
        {drifted && (
          <span
            className={`font-mono text-[9px] ${contribution.drift > 0 ? 'text-emerald-500' : 'text-amber-500'}`}
            title={`Weight ${signed(contribution.drift)} vs cold-start prior ${contribution.prior} (online Delta-Rule learning)`}
          >
            {contribution.drift > 0 ? '▲' : '▼'}{signed(contribution.drift, 2)}
          </span>
        )}
      </div>
    </div>
  );
});

function DecisionLensPanelBase({ rationales }: DecisionLensPanelProps) {
  // Pin by stable key so a live burst of new decisions can't yank the view while
  // the operator is inspecting one. Null = follow the latest decision.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);

  const latest = rationales.length > 0 ? rationales[rationales.length - 1] : null;
  const pinned = pinnedKey ? rationales.find((r) => keyOf(r) === pinnedKey) ?? null : null;
  const active = pinned ?? latest;

  // Newest-first strip of the last 10 decisions for quick scrubbing.
  const recent = useMemo(() => rationales.slice(-10).reverse(), [rationales]);

  const maxAbs = useMemo(
    () => (active ? active.contributions.reduce((m, c) => Math.max(m, Math.abs(c.contribution)), 0) : 0),
    [active],
  );

  if (!active) {
    return (
      <div className="p-4 text-xs italic text-gray-500">
        Decision Lens idle — the engine has not committed an autonomous decision yet. Feature
        attribution appears here the moment target selection begins.
      </div>
    );
  }

  const confidencePct = Math.round(active.mlConfidence * 100);
  const blended = active.heuristicScore * active.heuristicWeight + active.mlScore * active.mlWeight;

  return (
    <div className="space-y-3 p-2 font-sans">
      {/* Recent-decision scrubber */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Recent</span>
        {recent.map((r) => {
          const k = keyOf(r);
          const isActive = k === keyOf(active);
          return (
            <button
              key={k}
              onClick={() => setPinnedKey(isActive && !pinned ? null : k)}
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                isActive
                  ? 'border-gray-800 bg-gray-800 text-white'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-400'
              }`}
              title={`Step ${r.step}: ${r.selector} (score ${r.finalScore})`}
            >
              #{r.step}
            </button>
          );
        })}
        {pinned && (
          <button
            onClick={() => setPinnedKey(null)}
            className="ml-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-blue-100"
          >
            ⏵ Follow live
          </button>
        )}
      </div>

      {/* Chosen element header */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                {active.tagName}
              </span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${roleTone[active.semanticRole] ?? roleTone.UNKNOWN}`}>
                {active.semanticRole}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Step {active.step}</span>
            </div>
            <div className="truncate font-mono text-xs text-gray-700" title={active.selector}>
              {active.selector}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Risk score</div>
            <div className="font-mono text-lg font-bold text-gray-900">{active.finalScore.toFixed(2)}</div>
          </div>
        </div>

        {/* ML confidence gauge */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-gray-500">
            <span>ML CONFIDENCE (sigmoid of logit)</span>
            <span className="font-mono text-gray-700">{confidencePct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-400 to-emerald-500"
              style={{ width: `${confidencePct}%` }}
            />
          </div>
        </div>

        {/* Blend + logit math (the exact numbers behind the pick) */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
            <div className="text-[9px] font-semibold uppercase text-gray-400">Score blend</div>
            <div className="font-mono text-gray-700">
              {active.heuristicScore.toFixed(1)}×{active.heuristicWeight} + {active.mlScore.toFixed(1)}×{active.mlWeight}
            </div>
            <div className="font-mono text-[10px] text-gray-400">= {blended.toFixed(2)} pre-penalty</div>
          </div>
          <div className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5">
            <div className="text-[9px] font-semibold uppercase text-gray-400">Perceptron logit</div>
            <div className="font-mono text-gray-700">
              bias {signed(active.bias)} → z {signed(active.rawLogit)}
            </div>
            <div className="font-mono text-[10px] text-gray-400">σ(z) = {active.mlConfidence.toFixed(3)}</div>
          </div>
        </div>
      </div>

      {/* Exact feature attribution waterfall */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Feature attribution — exact weight × value
          </span>
          <span className="text-[9px] text-gray-400">{active.contributions.length} active</span>
        </div>
        {active.contributions.length === 0 ? (
          <div className="py-2 text-[11px] italic text-gray-400">
            No feature fired on this element — decision driven by bias alone.
          </div>
        ) : (
          <div>
            {active.contributions.map((c) => (
              <ContributionRow key={c.feature} contribution={c} maxAbs={maxAbs} />
            ))}
          </div>
        )}
      </div>

      {/* Runner-up counterfactual */}
      {active.runnerUp && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Why not the runner-up?
          </div>
          <div className="mb-2 flex items-center justify-between">
            <span className="truncate font-mono text-[11px] text-gray-600" title={active.runnerUp.selector}>
              {active.runnerUp.tagName} · {active.runnerUp.selector}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-gray-500">
              score {active.runnerUp.finalScore.toFixed(2)}
            </span>
          </div>
          {active.runnerUp.decisiveFeatures.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {active.runnerUp.decisiveFeatures.map((d) => (
                <span
                  key={d.feature}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    d.delta > 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                  title={`${d.label}: ${signed(d.delta)} in favour of the ${d.delta > 0 ? 'chosen element' : 'runner-up'}`}
                >
                  {d.label} {signed(d.delta, 2)}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-[11px] italic text-gray-400">Separated only by penalty / tie-break, not features.</div>
          )}
        </div>
      )}
    </div>
  );
}

// Memoized: only re-renders when the rationales array identity changes (the
// controller replaces it per new decision), never on unrelated dashboard state.
const DecisionLensPanel = memo(DecisionLensPanelBase);
export default DecisionLensPanel;
