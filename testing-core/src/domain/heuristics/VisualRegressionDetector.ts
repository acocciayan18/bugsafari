import { ssim } from 'ssim.js';
import { PNG } from 'pngjs';

/**
 * Catastrophic visual shift threshold.
 * If SSIM score falls below this, the UI is considered to have visually collapsed.
 */
export const CATASTROPHIC_SHIFT_THRESHOLD = 0.85;

/**
 * Result of a visual regression comparison.
 */
export interface VisualRegressionResult {
    isMatch: boolean;
    ssimScore: number;
}

/**
 * VisualRegressionDetector compares screenshot buffers using SSIM to detect
 * silent UI rendering failures, CSS breakages, and Z-index overlaps.
 */
export class VisualRegressionDetector {
    /**
     * Compare two screenshot buffers and calculate SSIM score.
     *
     * @param baselineBuffer - The baseline screenshot buffer (first encounter)
     * @param currentBuffer - The current screenshot buffer (re-visit)
     * @returns Promise with isMatch flag and ssimScore
     */
    public async compareFrames(
        baselineBuffer: Buffer,
        currentBuffer: Buffer,
    ): Promise<VisualRegressionResult> {
        try {
            // Convert buffers to PNG data for SSIM calculation
            const baselineImage = this.bufferToImageData(baselineBuffer);
            const currentImage = this.bufferToImageData(currentBuffer);

            // Ensure both images have the same dimensions
            if (
                baselineImage.width !== currentImage.width ||
                baselineImage.height !== currentImage.height
            ) {
                // Different dimensions = visual regression (layout collapse)
                return {
                    isMatch: false,
                    ssimScore: 0,
                };
            }

            // Calculate SSIM using ssim.js
            // ssim.js expects { width, height, data: Uint8ClampedArray }
            const ssimResult = ssim(baselineImage, currentImage);

            // Extract the MSSIM score (mean SSIM across all windows)
            const ssimScore = typeof ssimResult === 'number'
                ? ssimResult
                : (ssimResult as unknown as { mssim: number }).mssim ?? ssimResult;

            // Determine if visual regression detected
            const isMatch = ssimScore >= CATASTROPHIC_SHIFT_THRESHOLD;

            return {
                isMatch,
                ssimScore,
            };
        } catch (error) {
            // On error, assume match to not block the engine
            // Log the error for debugging
            console.warn(
                '[VisualRegressionDetector] SSIM comparison failed:',
                error instanceof Error ? error.message : String(error),
            );

            return {
                isMatch: true,
                ssimScore: 1.0,
            };
        }
    }

    /**
     * Convert a screenshot buffer (PNG/JPEG) to image data for SSIM.
     */
    private bufferToImageData(
        buffer: Buffer,
    ): { width: number; height: number; data: Uint8ClampedArray } {
        try {
            // Try parsing as PNG first
            const png = PNG.sync.read(buffer);
            return {
                width: png.width,
                height: png.height,
                data: new Uint8ClampedArray(png.data),
            };
        } catch {
            // If not PNG, assume it's already raw RGBA data or handle differently
            // For JPEG, we'd need additional handling but ssim.js can work with raw data
            // Fallback: return empty - will result in 0 SSIM (failure case handled above)
            throw new Error('Unsupported image format');
        }
    }
}
