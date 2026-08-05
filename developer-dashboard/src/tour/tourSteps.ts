// Centralized tour configuration. One ordered list of logical anchors; the builder
// resolves the viewport-dependent sidebar target and drops any anchor whose element
// is absent (e.g. Save on a fresh run, the desktop rail on mobile). Extend by adding
// an anchor here plus a matching data-tour attribute in the view.

import type { DriveStep } from 'driver.js';

interface TourAnchor {
  selector: string;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over';
  align?: 'start' | 'center' | 'end';
}

const WELCOME_STEP: DriveStep = {
  popover: {
    title: 'Welcome to BugSafari',
    description: 'Your autonomous exploratory tester. Quick tour of the command center — under a minute. You can skip anytime.',
    showButtons: ['next', 'close'],
  },
};

function toStep(a: TourAnchor): DriveStep {
  return {
    element: a.selector,
    popover: {
      title: a.title,
      description: a.description,
      side: a.side ?? 'bottom',
      align: a.align ?? 'start',
    },
  };
}

// Below-`lg` the rail collapses into a drawer, so navigation is reached via the top-bar toggle.
function sidebarAnchor(isCompact: boolean): TourAnchor {
  return {
    selector: isCompact ? '[data-tour="nav-toggle"]' : '[data-tour="sidebar-nav"]',
    title: 'Navigation',
    description: 'Move between Dashboard, Forensic History, and Settings from here.',
    side: isCompact ? 'bottom' : 'right',
    align: 'start',
  };
}

const DASHBOARD_ANCHORS: TourAnchor[] = [
  {
    selector: '[data-tour="config"]',
    title: 'Testing Configuration',
    description: 'Pick the infiltration profile, boundary lock, and target auth before a run. Locked once testing starts.',
  },
  {
    selector: '[data-tour="start"]',
    title: 'Run Controls',
    description: 'Enter a public URL and Start Testing. Pause, Resume, and Stop appear here while a run is live.',
    align: 'end',
  },
  {
    selector: '[data-tour="live-feed"]',
    title: 'Live Feed',
    description: 'Real-time screencast of the browser the engine is driving — watch it explore the target app.',
    side: 'right',
  },
  {
    selector: '[data-tour="telemetry-tab"]',
    title: 'Telemetry',
    description: 'Live stream of every element scored and action taken. Toggle the verbose trace for full detail, or hit the ? for a per-stream guide.',
  },
  {
    selector: '[data-tour="findings-tab"]',
    title: 'Findings',
    description: 'Crashes, unhandled faults, and boundary defects the run uncovers collect here.',
  },
  {
    selector: '[data-tour="network-tab"]',
    title: 'Network',
    description: 'Every HTTP request the target makes — failed calls, wrong status codes, and slow endpoints.',
  },
  {
    selector: '[data-tour="console-tab"]',
    title: 'Console',
    description: 'Raw browser console output from the page under test — logs, warnings, and script errors.',
  },
  {
    selector: '[data-tour="save-session"]',
    title: 'Save & Export',
    description: 'When a run ends, save it to Forensic History for the full replayable report.',
    align: 'end',
  },
];

// Welcome (centered) first, then every anchor whose element is currently in the DOM.
export function buildTourSteps(isCompact: boolean): DriveStep[] {
  const anchors = [sidebarAnchor(isCompact), ...DASHBOARD_ANCHORS];
  const steps: DriveStep[] = [WELCOME_STEP];
  for (const a of anchors) {
    if (document.querySelector(a.selector)) steps.push(toStep(a));
  }
  return steps;
}
