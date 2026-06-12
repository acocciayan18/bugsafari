# TODO: Implement object-fit: cover rendering for LiveFeed

## Information Gathered:
- Current file: `developer-dashboard/src/components/LiveFeed.tsx`
- Current behavior uses `object-fit: contain` approach (fit entire screenshot with margins)
- Canvas internal resolution is set to NATIVE_VIEWPORT_WIDTH/HEIGHT (1440x900)
- CSS display size scales up based on container, but this stretches the image incorrectly
- BinaryFrameReceiver in `developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts` handles frame rendering

## Plan:
The fix requires changing the LiveFeed component to implement proper `object-fit: cover` behavior:

### Step 1: Update LiveFeed.tsx
Replace `calculateFitToContainer` with `calculateCoverDimensions` that:
- Uses `scale = Math.max(containerWidth / imageWidth, containerHeight / imageHeight)` for cover behavior
- Sets canvas INTERNAL resolution to scaled dimensions (not CSS display size)
- Removes CSS scaling - canvas internal resolution should match display

### Render Logic:
```
1. Get container dimensions from containerRef
2. imageWidth = NATIVE_VIEWPORT_WIDTH (1440), imageHeight = NATIVE_VIEWPORT_HEIGHT (900)
3. Calculate scale = Math.max(containerWidth / imageWidth, containerHeight / imageHeight)
4. displayWidth = Math.round(imageWidth * scale)
5. displayHeight = Math.round(imageHeight * scale)
6. Set canvas.width = displayWidth, canvas.height = displayHeight (internal resolution)
7. Draw image at 0, 0 with displayWidth, displayHeight (fills canvas, centers/crops automatically)
```

### Step 2: Update BinaryFrameReceiver.ts
Update CanvasFrameRenderer to match the new canvas dimensions dynamically
- Remove fixed dimension setting in constructor
- Allow dynamic dimension updates from parent

## Dependent Files:
- developer-dashboard/src/components/LiveFeed.tsx - PRIMARY
- developer-dashboard/src/infrastructure/socket/BinaryFrameReceiver.ts - SECONDARY

## Followup Steps:
1. Test the rendering in browser
2. Verify no whitespace on any edge
3. Verify cropping works correctly
4. Verify FPS performance maintained

## Implementation Details:

### LiveFeed.tsx changes:
- Replace `calculateFitToContainer` with `calculateCoverDimensions`
- Update canvas initialization to set internal resolution to scaled dimensions
- Remove CSS width/height scaling - let canvas natural size fill container
- Change `object-contain` to `object-cover` (orremove object-fit)

### BinaryFrameReceiver.ts changes:
- Make dimensions dynamic in CanvasFrameRenderer
- Remove fixed setDimensions call in constructor
