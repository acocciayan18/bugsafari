export function parseAndFormatStep(rawStep: string): { formattedText: string, originalStepNumber: number, title: string } {
    const stepMatch = rawStep.match(/^Step (\d+):/);
    const stepNumber = stepMatch ? parseInt(stepMatch[1], 10) : 0;

    const withoutPrefix = rawStep.replace(/^Step \d+: /, '');
    const [actionAndSelector] = withoutPrefix.split(' at http');

    const spaceIndex = actionAndSelector.indexOf(' ');
    const actionType = spaceIndex > -1 ? actionAndSelector.substring(0, spaceIndex).toUpperCase() : actionAndSelector.toUpperCase();
    const selector = spaceIndex > -1 ? actionAndSelector.substring(spaceIndex + 1) : '';

    const cleanSelector = selector.split(' > ').pop()?.replace(/:nth-of-type\(\d+\)/g, '') || selector;

    let title = "Standard Interaction";
    let formattedText = `Interacted with <${cleanSelector}>`;

    // Provide descriptive attack patterns for humans to reproduce
    if (actionType.includes('ROUTETRASHER')) {
        title = "State Desync Attack (RouteTrasher)";
        formattedText = `Triggered a potential state mismatch by interacting with <${cleanSelector}> while simultaneously and rapidly triggering browser Back/Forward navigation events.`;
    } else if (actionType.includes('BUTTON-SPAMMER')) {
        title = "Race Condition Attack (Spammer)";
        formattedText = `Fired massive concurrent click events (50+) on <${cleanSelector}> at the exact same millisecond to overwhelm the event loop and test for race conditions/double-submissions.`;
    } else if (actionType.includes('FORMBYPASSER')) {
        title = "Client-Side Bypass";
        formattedText = `Stripped all HTML5 validation attributes (required, min, max, patterns) from the DOM and forcefully submitted <${cleanSelector}> to test backend validation.`;
    } else if (actionType.includes('FUZZER') || actionType.includes('SECURITYVULNERABILITY')) {
        title = "Payload Injection";
        formattedText = `Injected a malicious chaos/fuzzing payload into <${cleanSelector}> to test for injection flaws or unhandled parsing exceptions.`;
    } else if (actionType.includes('CLICK')) {
        title = "Navigation / State Change";
        formattedText = `Clicked <${cleanSelector}>`;
    } else if (actionType.includes('TYPE') || actionType.includes('INPUT')) {
        title = "Data Entry";
        formattedText = `Typed standard data into <${cleanSelector}>`;
    }

    return { formattedText, originalStepNumber: stepNumber, title };
}
