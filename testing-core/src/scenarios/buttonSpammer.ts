import type { Page } from 'playwright';

/**
 * Bombards a target element with rapid, concurrent click events.
 * Intentionally does NOT wait for action completion to try and overwhelm SPA state.
 *
 * @param page Playwright Page object.
 * @param selector Selector for the target element.
 * @param intensity Number of clicks to fire concurrently.
 */
export async function executeSpam(page: Page, selector: string, intensity: number = 20): Promise<void> {
    console.log(`[Forensic Telemetry] Initiating click spam burst on '${selector}' with intensity ${intensity}`);

    const clickPromises: Promise<void>[] = [];

    // Rapid for-loop without await on individual clicks
    for (let i = 0; i < intensity; i++) {
        // Using force: true to bypass actionability checks (visible, stable, etc.)
        const clickPromise = page.click(selector, { force: true })
            .catch((error: Error) => {
                // Catch and ignore "Target Closed" and similar errors resulting from page crash/navigation
                const errorMessage = error.message.toLowerCase();
                if (
                    errorMessage.includes('target closed') ||
                    errorMessage.includes('execution context was destroyed') ||
                    errorMessage.includes('navigating') ||
                    errorMessage.includes('browser has been closed') ||
                    errorMessage.includes('target page, context or browser has been closed')
                ) {
                    // Ignored intentionally
                } else {
                    console.error(`[Forensic Telemetry] Non-fatal error during spam: ${error.message}`);
                }
            });

        clickPromises.push(clickPromise);
    }

    // Wait for the burst to finish settling
    await Promise.all(clickPromises);
    
    console.log(`[Forensic Telemetry] Click spam burst completed on '${selector}'`);
}
