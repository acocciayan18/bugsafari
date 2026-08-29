// Pure predicate for whether the Start control may fire. A blank/whitespace URL,
// incomplete target-auth, or a blocked (local/self) target all disqualify a launch.
// Kept framework-free so the dashboard button, Enter key, and click handler share one gate.

export interface LaunchGateInput {
    urlInput: string;
    authIncomplete: boolean;
    isBlockedTarget: boolean;
}

export function isLaunchBlocked({ urlInput, authIncomplete, isBlockedTarget }: LaunchGateInput): boolean {
    if (urlInput.trim() === '') return true;
    return authIncomplete || isBlockedTarget;
}
