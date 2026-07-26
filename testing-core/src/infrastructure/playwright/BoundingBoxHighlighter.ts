import type { Page } from 'playwright';

// Visual action a highlight represents — drives the indicator color.
export type HighlightAction = 'click' | 'input' | 'hover' | 'navigate';

// Non-intrusive per-action palette. Baked into the JPEG frame so it is always in
// the same coordinate space as what the operator sees — it can never drift.
const ACTION_COLOR: Record<HighlightAction, string> = {
  click: '#22d3ee',    // cyan
  input: '#f59e0b',    // amber
  hover: '#a78bfa',    // violet
  navigate: '#34d399', // green
};

// Single reusable overlay id — kept under the bugsafari-highlight- prefix so
// DomHasher keeps excluding it from state hashing.
const OVERLAY_ID = 'bugsafari-highlight-active';
const STYLE_ID = 'bugsafari-highlight-style';

/**
 * Draws ONE reusable, gliding bounding-box over the element the engine is
 * currently interacting with. Reusing a single node (position transitioned) makes
 * the indicator slide smoothly between targets instead of blinking, and it stays
 * visible through the action rather than pre-flashing and vanishing.
 */
export class BoundingBoxHighlighter {
  // Positions/repositions the active overlay onto `selector`. No auto-remove — it
  // simply glides to the next target on the next action.
  public async moveHighlight(page: Page, selector: string, action: HighlightAction = 'click'): Promise<void> {
    try {
      const box = await page.locator(selector).first().boundingBox();
      if (!box) return;
      const color = ACTION_COLOR[action] ?? ACTION_COLOR.click;

      await page.evaluate(
        ({ overlayId, styleId, x, y, width, height, color }) => {
          if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
              #${overlayId} {
                position: fixed; pointer-events: none; z-index: 2147483647;
                box-sizing: border-box; border-radius: 3px; background: transparent;
                border: 2px solid var(--bs-hl-color);
                transition: left .18s ease, top .18s ease, width .18s ease, height .18s ease, border-color .18s ease;
                animation: bs-hl-pulse 1.4s ease-in-out infinite;
              }
              @keyframes bs-hl-pulse {
                0%, 100% { box-shadow: 0 0 4px var(--bs-hl-color); }
                50%      { box-shadow: 0 0 12px var(--bs-hl-color), 0 0 2px var(--bs-hl-color); }
              }`;
            document.head.appendChild(style);
          }
          let overlay = document.getElementById(overlayId);
          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = overlayId;
            document.body.appendChild(overlay);
          }
          overlay.style.setProperty('--bs-hl-color', color);
          overlay.style.left = `${x}px`;
          overlay.style.top = `${y}px`;
          overlay.style.width = `${width}px`;
          overlay.style.height = `${height}px`;
        },
        { overlayId: OVERLAY_ID, styleId: STYLE_ID, x: box.x, y: box.y, width: box.width, height: box.height, color },
      );
    } catch {
      // Element gone / navigation in-flight — non-fatal, next action re-homes it.
    }
  }

  // Removes the overlay + injected style. Called on run teardown.
  public async clearHighlights(page: Page): Promise<void> {
    try {
      await page.evaluate(
        ({ overlayId, styleId }) => {
          document.getElementById(overlayId)?.remove();
          document.getElementById(styleId)?.remove();
        },
        { overlayId: OVERLAY_ID, styleId: STYLE_ID },
      );
    } catch {
      // Page already closed — nothing to clean.
    }
  }
}
