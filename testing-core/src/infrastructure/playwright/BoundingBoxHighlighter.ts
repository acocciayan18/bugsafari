import type { Page, Locator } from 'playwright';

/**
 * Utility to highlight elements with red bounding boxes for visual debugging.
 * Shows where the system is navigating and what it's about to interact with.
 */
export class BoundingBoxHighlighter {
  private highlightedElements: string[] = [];

  /**
   * Highlights an element with a red bounding box
   * @param page - Playwright page instance
   * @param selector - CSS selector of the element to highlight
   * @param duration - How long to keep the highlight visible (ms). 0 = permanent until next action
   */
  public async highlightElement(page: Page, selector: string, duration = 2000): Promise<void> {
    try {
      const boundingBox = await page.locator(selector).boundingBox();

      if (!boundingBox) {
        return;
      }

      // Namespaced id — DomHasher excludes [id^="bugsafari-highlight-"] so this
      // engine-injected overlay never registers as an app state change.
      const highlightId = `bugsafari-highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create overlay div with red border
      await page.evaluate(
        ({ id, x, y, width, height }) => {
          const overlay = document.createElement('div');
          overlay.id = id;
          overlay.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: ${width}px;
            height: ${height}px;
            border: 3px solid red;
            box-shadow: 0 0 10px rgba(255, 0, 0, 0.5), inset 0 0 10px rgba(255, 0, 0, 0.3);
            pointer-events: none;
            z-index: 2147483647;
            background: rgba(255, 0, 0, 0.05);
            transition: all 0.1s ease;
          `;
          document.body.appendChild(overlay);
        },
        { id: highlightId, x: boundingBox.x, y: boundingBox.y, width: boundingBox.width, height: boundingBox.height }
      );

      this.highlightedElements.push(highlightId);

      // Auto-remove after duration if specified
      if (duration > 0) {
        setTimeout(() => {
          page.evaluate((id) => {
            document.getElementById(id)?.remove();
          }, highlightId).catch(() => undefined);

          this.highlightedElements = this.highlightedElements.filter((id) => id !== highlightId);
        }, duration);
      }
    } catch (error) {
      // Silently fail if element doesn't exist
    }
  }

  /**
   * Highlights multiple elements
   * @param page - Playwright page instance
   * @param selectors - Array of CSS selectors to highlight
   * @param duration - How long to keep highlights visible
   */
  public async highlightElements(page: Page, selectors: string[], duration = 2000): Promise<void> {
    await Promise.all(selectors.map((selector) => this.highlightElement(page, selector, duration)));
  }

  /**
   * Highlights by locator object
   * @param page - Playwright page instance
   * @param locator - Playwright Locator
   * @param duration - How long to keep highlight visible
   */
  public async highlightLocator(page: Page, locator: Locator, duration = 2000): Promise<void> {
    try {
      const boundingBox = await locator.boundingBox();

      if (!boundingBox) {
        return;
      }

      // Namespaced id — DomHasher excludes [id^="bugsafari-highlight-"] so this
      // engine-injected overlay never registers as an app state change.
      const highlightId = `bugsafari-highlight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create overlay using absolute positioning
      await page.evaluate(
        ({ id, x, y, width, height }) => {
          const overlay = document.createElement('div');
          overlay.id = id;
          overlay.style.cssText = `
            position: fixed;
            left: ${x}px;
            top: ${y}px;
            width: ${width}px;
            height: ${height}px;
            border: 3px solid red;
            box-shadow: 0 0 10px rgba(255, 0, 0, 0.5), inset 0 0 10px rgba(255, 0, 0, 0.3);
            pointer-events: none;
            z-index: 2147483647;
            background: rgba(255, 0, 0, 0.05);
          `;
          document.body.appendChild(overlay);
        },
        { id: highlightId, x: boundingBox.x, y: boundingBox.y, width: boundingBox.width, height: boundingBox.height }
      );

      this.highlightedElements.push(highlightId);

      if (duration > 0) {
        setTimeout(() => {
          page.evaluate((id) => {
            document.getElementById(id)?.remove();
          }, highlightId).catch(() => undefined);

          this.highlightedElements = this.highlightedElements.filter((id) => id !== highlightId);
        }, duration);
      }
    } catch (error) {
      // Silently fail
    }
  }

  /**
   * Clears all highlights
   * @param page - Playwright page instance
   */
  public async clearHighlights(page: Page): Promise<void> {
    if (this.highlightedElements.length === 0) {
      return;
    }

    await page.evaluate((ids) => {
      ids.forEach((id) => {
        document.getElementById(id)?.remove();
      });
    }, this.highlightedElements);

    this.highlightedElements = [];
  }

  /**
   * Highlights an element briefly during an action (e.g., before clicking)
   * Useful for visual debugging without cluttering the screen
   * @param page - Playwright page instance
   * @param selector - Element selector
   */
  public async flashHighlight(page: Page, selector: string): Promise<void> {
    await this.highlightElement(page, selector, 800);
  }

  /**
   * Gets current highlighted element IDs
   */
  public getHighlightedElements(): string[] {
    return [...this.highlightedElements];
  }
}
