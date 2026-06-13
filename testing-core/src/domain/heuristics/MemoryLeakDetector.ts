/**
 * Result of memory leak analysis.
 */
export interface LeakAnalysisResult {
    isLeaking: boolean;
    leakAmountMB: number;
    visitCount: number;
}

/**
 * MemoryLeakDetector tracks heap usage per DOM state and detects
 * monotonically growing memory patterns indicating memory leaks.
 */
export class MemoryLeakDetector {
    private readonly heapHistory = new Map<string, number[]>();
    private readonly LEAK_THRESHOLD_MB = 3;
    private readonly MIN_VISITS = 3;

    /**
     * Record heap measurement and analyze for leaks.
     * @param hash - DOM state hash
     * @param currentHeapMB - Current heap size in MB
     * @returns Leak analysis result
     */
    public recordAndAnalyze(hash: string, currentHeapMB: number): LeakAnalysisResult {
        const history = this.heapHistory.get(hash) ?? [];
        history.push(currentHeapMB);
        this.heapHistory.set(hash, history);

        const visitCount = history.length;

        // Not enough data to detect leak
        if (visitCount < this.MIN_VISITS) {
            return { isLeaking: false, leakAmountMB: 0, visitCount };
        }

        // Check if memory is monotonically increasing (strictly growing)
        let isMonotonicallyGrowing = true;
        for (let i = 1; i < history.length; i++) {
            if (history[i] <= history[i - 1]) {
                isMonotonicallyGrowing = false;
                break;
            }
        }

        const firstVisit = history[0];
        const currentVisit = history[history.length - 1];
        const leakAmountMB = currentVisit - firstVisit;

        // Detect leak: must be monotonically growing AND exceed threshold
        const isLeaking = isMonotonicallyGrowing && leakAmountMB > this.LEAK_THRESHOLD_MB;

        return { isLeaking, leakAmountMB, visitCount };
    }

    /**
     * Get heap history for a specific DOM state.
     */
    public getHistory(hash: string): number[] {
        return this.heapHistory.get(hash) ?? [];
    }

    /**
     * Clear all history (useful for starting fresh).
     */
    public clear(): void {
        this.heapHistory.clear();
    }
}
