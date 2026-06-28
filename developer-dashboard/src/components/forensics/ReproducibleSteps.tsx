import React from 'react';
import { parseAndFormatStep } from '../../utils/semanticFormatter';

interface BugFinding {
    bugId?: string;
    type?: string;
    message?: string;
    selector?: string;
    evidence?: string;
    advice?: string;
    payloadUsed?: string;
}

interface ReproducibleStepsProps {
    steps: string[];
    findings: BugFinding[] | undefined | null;
}

/**
 * Safe check for non-empty findings array
 */
function hasValidFindings(findings: BugFinding[] | undefined | null): boolean {
    return !!(findings && Array.isArray(findings) && findings.length > 0);
}

export const ReproducibleSteps: React.FC<ReproducibleStepsProps> = ({ steps, findings }) => {
    // Guard: no steps at all
    if (!steps || steps.length === 0) {
        return <div className="text-sm text-slate-500">No steps recorded.</div>;
    }

    const hasFindings = hasValidFindings(findings);

    // Phase Grouping: Group sequential identical steps into "Phases"
    const groupedPhases = steps.reduce((acc: any[], rawStep, index) => {
        const { formattedText, originalStepNumber, title } = parseAndFormatStep(rawStep);

        const lastPhase = acc[acc.length - 1];

        // If same title and formattedText, increment count
        if (lastPhase && lastPhase.title === title && lastPhase.formattedText === formattedText) {
            lastPhase.count += 1;
            lastPhase.stepNumbers.push(originalStepNumber || index + 1);
            return acc;
        }

        // New phase starts
        return acc.concat([{
            title,
            formattedText,
            originalStepNumber: originalStepNumber || index + 1,
            count: 1,
            stepNumbers: [originalStepNumber || index + 1]
        }]);
    }, []);

    // Vite Network Filter: Drop NETWORK bugs with Vite noise unless it's a real server collapse
    const filteredFindings = findings ? findings.filter(bug => {
        const msg = bug.message || "";
        const type = bug.type || "";

        // Drop NETWORK errors with Vite noise
        if (type.includes("NETWORK") || type.includes("REQUEST")) {
            if ((msg.includes("@vite") || msg.includes(".js?v=") || msg.includes("env.mjs")) &&
                !msg.includes("server collapse")) {
                return false;
            }
        }
        return true;
    }) : [];

    // Smarter grouping: Group filtered findings by TYPE + first 30 chars of message
    const uniqueFindings = filteredFindings.length > 0 ? filteredFindings.reduce((acc: any[], current: any) => {
        const typeMatch = current.type || "UNKNOWN";
        const messageSnippet = current.message ? current.message.substring(0, 30) : "";

        const existing = acc.find(item =>
            (item.type || "UNKNOWN") === typeMatch &&
            (item.message || "").substring(0, 30) === messageSnippet
        );

        if (!existing) {
            return acc.concat([{ ...current, duplicateCount: 1 }]);
        } else {
            existing.duplicateCount += 1;
            return acc;
        }
    }, []) : [];

    console.log('[ReproducibleSteps] Rendering with:', {
        stepsCount: steps.length,
        findingsCount: findings?.length ?? 0,
        uniqueFindingsCount: uniqueFindings?.length ?? 0,
        hasFindings,
        firstFinding: hasFindings ? findings?.[0] : null
    });

    return (
        <div className="bg-white border border-slate-200 p-6 rounded-md shadow-sm mt-4">
            <h3 className="text-sm font-bold mb-6 uppercase tracking-wider text-slate-800 border-b pb-2">
                Steps to Reproduce
            </h3>

            <div className="relative border-l-2 border-slate-200 ml-3">
                {/* Render grouped phases instead of individual steps */}
                {groupedPhases.map((phase, pIdx) => (
                    <div key={`phase-${pIdx}`} className="mb-6 relative pl-6">
                        <div className="absolute w-3 h-3 bg-slate-800 rounded-full -left-[7px] top-1 ring-4 ring-white"></div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold text-slate-400">PHASE {pIdx + 1}</span>
                                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded uppercase">{phase.title}</span>
                                {phase.count > 1 && (
                                    <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded">
                                        Executed {phase.count}x
                                    </span>
                                )}
                            </div>
                            <p className="text-slate-700 text-sm bg-slate-50 border border-slate-200 p-3 rounded-md shadow-sm">
                                {phase.formattedText}
                            </p>
                        </div>
                    </div>
                ))}

                {/* ALWAYS Render - Vulnerabilities Triggered Section */}
                {/* This renders after all steps if findings exist, or shows fallback */}
                <div className="relative pl-6 mt-8">
                    {hasFindings ? (
                        <>
                            {/* Red Pulse Dot for Bugs */}
                            <div className="absolute w-4 h-4 bg-red-500 rounded-full -left-[9px] top-0 ring-4 ring-white animate-pulse"></div>

                            <h4 className="text-red-600 font-bold tracking-wide uppercase mb-3 flex items-center gap-2">
                                🚨 Vulnerabilities Triggered
                            </h4>

                            <div className="flex flex-col gap-4">
                                {uniqueFindings.map((bug, bIdx) => (
                                    <div key={`bug-${bIdx}`} className="border-2 border-red-200 bg-red-50 p-4 rounded-md shadow-sm">
                                        <div className="flex items-center gap-2 mb-2 border-b border-red-100 pb-2">
                                            <span className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded uppercase tracking-wider">
                                                {bug.type || "CRITICAL ERROR"}
                                            </span>
                                            <span className="text-xs text-red-400 font-mono">ID: {bug.bugId || "Unknown"}</span>
                                            {bug.duplicateCount && bug.duplicateCount > 1 && (
                                                <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-1 rounded ml-2">
                                                    Occurred {bug.duplicateCount} times
                                                </span>
                                            )}
                                        </div>

                                        <p className="text-sm text-slate-800 mb-3 font-semibold">
                                            {bug.message || "No message provided"}
                                        </p>

                                        {bug.selector && (
                                            <div className="mb-3">
                                                <span className="text-xs font-bold text-slate-500 uppercase">Target Element:</span>
                                                <p className="text-xs font-mono bg-white border border-red-100 text-red-600 px-2 py-1 rounded mt-1 overflow-x-auto">
                                                    {bug.selector}
                                                </p>
                                            </div>
                                        )}

                                        {bug.evidence && (
                                            <div className="mb-3">
                                                <span className="text-xs font-bold text-slate-500 uppercase">Evidence / Stack Trace:</span>
                                                <pre className="text-xs font-mono bg-slate-900 text-green-400 p-2 rounded mt-1 overflow-x-auto max-h-40">
                                                    {bug.evidence}
                                                </pre>
                                            </div>
                                        )}

                                        {bug.payloadUsed && (
                                            <div className="mb-3">
                                                <span className="text-xs font-bold text-slate-500 uppercase">Payload Used:</span>
                                                <p className="text-xs font-mono bg-white border border-red-100 text-red-600 px-2 py-1 rounded mt-1 overflow-x-auto">
                                                    {bug.payloadUsed}
                                                </p>
                                            </div>
                                        )}

                                        {bug.advice && (
                                            <div className="mt-2 bg-white p-3 rounded border border-red-100">
                                                <span className="text-xs font-bold text-slate-500 uppercase block mb-1">AI Fix Suggestion:</span>
                                                <p className="text-sm text-slate-600 italic">{bug.advice}</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        /* Fallback: No findings but still show placeholder so users know where they'd appear */
                        <div className="relative pl-6 mt-4">
                            <div className="absolute w-3 h-3 bg-slate-300 rounded-full -left-[7px] top-1 ring-4 ring-white"></div>
                            <div className="text-xs text-slate-400 italic pb-4">
                                No vulnerabilities detected in this trace.
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
