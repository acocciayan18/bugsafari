import { useState } from 'react';

/**
 * 🧭 Reproduction Playbook — a high-contrast, sequentially-numbered checklist of
 * the human-executable steps that led to a captured defect. Self-contained so it
 * can render natively inside any defect card (Error tab, Network tab, …).
 *
 * Each entry in `steps` is already a fully-formed narrative line (e.g.
 * "Step 2. Inject SQL payload into input field '#promoCode': ...").
 */
export default function ReproductionChecklist({ steps }: { steps: string[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(steps.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ReproductionChecklist] Failed to copy steps:', err);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-black uppercase tracking-wider text-amber-900">
          🧭 Reproduction Playbook
        </div>
        {steps.length > 0 && (
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-amber-800 transition-all hover:bg-amber-100 active:scale-95"
            title="Copy reproduction steps"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      {steps.length > 0 ? (
        <ol className="space-y-1.5">
          {steps.map((step, idx) => (
            <li
              key={`${idx}-${step}`}
              className="rounded border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-mono font-medium leading-relaxed text-gray-900 whitespace-pre-wrap break-words"
            >
              {step}
            </li>
          ))}
        </ol>
      ) : (
        <div className="text-xs italic text-gray-500">No reproduction steps available.</div>
      )}
    </div>
  );
}
