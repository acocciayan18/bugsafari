# Bounding Box Highlighter Documentation

## Overview

The **Bounding Box Highlighter** system provides visual debugging for Playwright-based test navigation. When the autonomous exploration engine runs, it draws red bounding boxes around elements before interacting with them, helping you understand exactly what the system is navigating to and clicking.

## Features

- **Red bounding boxes** around elements during interaction
- **Auto-clearing** highlights after configurable duration (800ms-2000ms default)
- **Multiple element highlighting** support
- **Visual feedback** for clicks, text input, and navigation
- **Non-intrusive** - uses high z-index and pointer-events: none to avoid interfering with page functionality

## How It Works

### Visual Indicators

Each highlight shows:
- **Red 3px border** - Clear, visible element boundary
- **Red shadow glow** - Soft shadow effect for better visibility
- **Subtle red tint** - Semi-transparent background overlay
- **Fixed positioning** - Stays visible during page scrolling

### Highlight Duration

- **Flash highlights** (800ms): Quick visual feedback for individual clicks
- **Standard highlights** (2000ms): Longer visibility for concurrent interactions
- **Permanent highlights** (duration: 0): Useful for debugging - highlight remains until manually cleared

## Integration Points

The highlighter is automatically integrated at:

1. **InteractionSimulator.buttonSpammer()** - Highlights before rapid clicking
2. **InteractionSimulator.concurrentClicker()** - Highlights all target elements
3. **AutonomousExplorationEngine.executeStandardInteraction()** - Highlights target before any interaction

## Usage Examples

### Basic Highlighting

```typescript
import { BoundingBoxHighlighter } from './infrastructure/playwright/BoundingBoxHighlighter';

const highlighter = new BoundingBoxHighlighter();

// Flash highlight (auto-clears after 800ms)
await highlighter.flashHighlight(page, '.submit-button');

// Custom duration highlight
await highlighter.highlightElement(page, '#login-form', 1500);

// Permanent highlight (until cleared)
await highlighter.highlightElement(page, '.important-element', 0);
```

### Multiple Elements

```typescript
// Highlight multiple elements at once
await highlighter.highlightElements(page, [
  '.button-1',
  '.button-2',
  '.button-3'
], 2000);
```

### Clearing Highlights

```typescript
// Clear all highlights
await highlighter.clearHighlights(page);

// Get list of currently highlighted elements
const highlightedIds = highlighter.getHighlightedElements();
console.log(`Currently highlighting: ${highlightedIds.length} elements`);
```

### Using Locator Objects

```typescript
const locator = page.locator('.dynamic-element');

// Highlight using Locator
await highlighter.highlightLocator(page, locator, 1500);
```

## Visual Styles

The bounding boxes use:
- **Border**: `3px solid red` - High contrast
- **Shadow**: `0 0 10px rgba(255, 0, 0, 0.5)` - Glow effect
- **Inset shadow**: `inset 0 0 10px rgba(255, 0, 0, 0.3)` - Depth effect
- **Background**: `rgba(255, 0, 0, 0.05)` - Subtle tint (5% opacity)
- **Z-index**: `2147483647` - Always on top (JavaScript's max safe z-index)

## Debugging with Screenshots

The highlights are visible in:
- **Headed mode** (with `headless: false`)
- **Screenshots** taken during test execution
- **Video recordings** of test runs

To capture the highlights in screenshots:

```typescript
await page.screenshot({ path: 'debug-with-highlights.png' });
```

## Performance Considerations

- **Minimal overhead**: Highlights are pure DOM elements with no JavaScript polling
- **Auto-cleanup**: Highlights are removed after their duration expires
- **Non-blocking**: Pointer events disabled, so highlights don't interfere with interactions

## Troubleshooting

### Highlights Not Appearing

1. Check element is visible and has dimensions:
   ```typescript
   const box = await page.locator('.selector').boundingBox();
   if (!box) console.log('Element has no bounding box');
   ```

2. Ensure element is not hidden by CSS `display: none`

3. Verify z-index isn't being overridden by page CSS

### Highlights Persisting Too Long

- Reduce duration parameter for faster auto-clear
- Manually call `clearHighlights()` between actions

### Multiple Highlights Overlapping

- Use `clearHighlights()` before creating new highlights
- Or let auto-clear handle removal (recommended)

## Configuration Options

Modify highlight duration by changing the defaults:

```typescript
// In InteractionSimulator.concurrentClicker
await this.highlighter.highlightElements(page, targetSelectors, 600); // 600ms

// In AutonomousExplorationEngine.executeStandardInteraction
await this.highlighter.flashHighlight(page, target.selector); // 800ms
```

## Integration with Telemetry

The highlighter works seamlessly with the existing telemetry system:
- Highlights trigger simultaneously with telemetry events
- No telemetry overhead from highlighting
- Enables visual correlation with logged actions

## Future Enhancements

Potential improvements:
- Different colors for different action types (click = red, input = blue, etc.)
- Animation effects (pulsing, fading)
- Element metadata display (tag name, dimensions)
- Conditional highlighting based on element properties
