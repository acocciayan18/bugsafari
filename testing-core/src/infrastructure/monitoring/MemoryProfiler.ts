import type { Page, CDPSession } from 'playwright';

/**
 * MemoryProfiler uses Chrome DevTools Protocol (CDP) to measure
 * JavaScript heap size for detecting memory leaks.
 */
export class MemoryProfiler {
    private client: CDPSession | null = null;

    /**
     * Attach CDP session to a Playwright page for memory monitoring.
     */
    public async attach(page: Page): Promise<CDPSession> {
        this.client = await page.context().newCDPSession(page);
        return this.client;
    }

    /**
     * Measure the current JS heap usage in Megabytes.
     * Forces garbage collection before measurement for accuracy.
     */
    public async measureHeap(client?: CDPSession): Promise<number> {
        const cdp = client ?? this.client;
        if (!cdp) {
            return 0;
        }

        try {
            // Enable heap profiler and force GC for accurate reading
            await cdp.send('HeapProfiler.enable').catch(() => { });
            await cdp.send('HeapProfiler.collectGarbage').catch(() => { });

            const metrics = await cdp.send('Runtime.getHeapUsage');
            return metrics.usedSize / (1024 * 1024); // Convert bytes to MB
        } catch (error) {
            console.warn('[MemoryProfiler] Failed to measure heap:', error);
            return 0;
        }
    }

    /**
     * Get the CDP session for external use.
     */
    public getClient(): CDPSession | null {
        return this.client;
    }

    /**
     * Dispose the CDP session.
     */
    public dispose(): void {
        if (this.client) {
            this.client.detach().catch(() => { });
            this.client = null;
        }
    }
}
