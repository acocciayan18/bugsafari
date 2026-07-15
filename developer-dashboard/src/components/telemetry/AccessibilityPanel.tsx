import type { A11yImpact, AccessibilityFinding } from '../../types';
import { CopyButton } from '../common/ForensicCardKit';

interface AccessibilityPanelProps {
  findings: AccessibilityFinding[];
}

// Impact → badge palette (mirrors axe-core severity ordering).
const IMPACT_STYLES: Record<A11yImpact, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  serious: 'bg-orange-100 text-orange-700 border-orange-200',
  moderate: 'bg-amber-100 text-amber-700 border-amber-200',
  minor: 'bg-sky-100 text-sky-700 border-sky-200',
};

const IMPACT_ORDER: Record<A11yImpact, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };

export default function AccessibilityPanel({ findings = [] }: AccessibilityPanelProps) {
  if (findings.length === 0) {
    return <div className="text-gray-500 italic py-4">No accessibility violations captured yet.</div>;
  }

  // Most severe first; stable within an impact bucket (arrival order preserved).
  const ordered = [...findings].sort((a, b) => IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact]);

  return (
    <div className="space-y-3 p-2">
      {ordered.map((f, idx) => (
        <div
          key={`${f.rule}-${f.selector}-${idx}`}
          className="bg-white border border-indigo-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex items-center justify-between border-b border-indigo-200 bg-indigo-50 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs text-white">♿</span>
              <span className="font-bold text-sm text-indigo-900 truncate">{f.rule}</span>
              <span className="rounded bg-indigo-200/60 px-1.5 py-0.5 font-mono text-[10px] text-indigo-800">WCAG {f.wcag}</span>
            </div>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${IMPACT_STYLES[f.impact]}`}>
              {f.impact}
            </span>
          </div>

          <div className="px-4 py-3 space-y-2">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Affected Element</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-gray-800">{f.selector || '(page-level)'}</code>
                {f.selector && <CopyButton text={f.selector} label="Selector" />}
              </div>
            </div>

            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</div>
              <p className="text-xs leading-relaxed text-gray-700 break-words">{f.description}</p>
            </div>

            <div className="rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">Suggested Fix</div>
              <p className="text-xs leading-relaxed text-emerald-800 break-words">{f.suggestedFix}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
