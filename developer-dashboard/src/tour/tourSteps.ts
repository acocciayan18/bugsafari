// Centralized tour configuration. Each tour is one ordered list of logical anchors;
// the builder resolves the viewport-dependent sidebar target and drops any anchor
// whose element is absent (e.g. Save on a fresh run, the desktop rail on mobile).
// Extend a tour by adding an anchor here plus a matching data-tour attribute in the view.

import type { DriveStep } from 'driver.js';

interface TourAnchor {
  selector: string;
  title: string;
  description: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

function welcomeStep(title: string, description: string): DriveStep {
  return { popover: { title, description, showButtons: ['next', 'close'] } };
}

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

// Keep only the welcome step plus anchors whose element is currently in the DOM.
function assemble(welcome: DriveStep, anchors: TourAnchor[]): DriveStep[] {
  const steps: DriveStep[] = [welcome];
  for (const a of anchors) {
    if (document.querySelector(a.selector)) steps.push(toStep(a));
  }
  return steps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard tour
// ─────────────────────────────────────────────────────────────────────────────

// Below-`lg` the rail collapses into a drawer, so navigation is reached via the top-bar toggle.
function sidebarAnchor(isCompact: boolean): TourAnchor {
  return {
    selector: isCompact ? '[data-tour="nav-toggle"]' : '[data-tour="sidebar-nav"]',
    title: 'Getting around',
    description: 'Use this menu to move between the Dashboard, your saved History, and Settings.',
    side: isCompact ? 'bottom' : 'right',
    align: 'start',
  };
}

const DASHBOARD_ANCHORS: TourAnchor[] = [
  {
    selector: '[data-tour="config"]',
    title: 'Set up your test',
    description: 'Choose how BugSafari behaves and, if the site needs a login, how it signs in. These settings lock once a test starts.',
  },
  {
    selector: '[data-tour="start"]',
    title: 'Start a test',
    description: 'Paste a public website address and press Start Testing. Pause, Resume, and Stop appear here while a test runs.',
    align: 'end',
  },
  {
    selector: '[data-tour="live-feed"]',
    title: 'Watch it work',
    description: 'A live view of BugSafari exploring the site, like a video of the browser it controls.',
    side: 'right',
  },
  {
    selector: '[data-tour="telemetry-tab"]',
    title: 'Telemetry',
    description: 'A live list of what BugSafari looks at and clicks. Press the ? on this tab for a short guide.',
  },
  {
    selector: '[data-tour="findings-tab"]',
    title: 'Findings',
    description: 'Bugs, crashes, and other problems BugSafari discovers collect here.',
  },
  {
    selector: '[data-tour="network-tab"]',
    title: 'Network',
    description: 'Every request the site makes. Failed, wrong, or slow ones are easy to spot here.',
  },
  {
    selector: '[data-tour="console-tab"]',
    title: 'Console',
    description: 'Messages from the site itself, including warnings and script errors.',
  },
  {
    selector: '[data-tour="save-session"]',
    title: 'Save your results',
    description: 'When a test finishes, save it to History for a full report you can reopen later.',
    align: 'end',
  },
];

export function buildTourSteps(isCompact: boolean): DriveStep[] {
  const welcome = welcomeStep(
    'Welcome to BugSafari',
    'BugSafari explores websites on its own and finds bugs for you. Here is a quick tour of the main screen. It takes under a minute, and you can skip anytime.',
  );
  return assemble(welcome, [sidebarAnchor(isCompact), ...DASHBOARD_ANCHORS]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Forensic History tour (on demand via the Help control)
// ─────────────────────────────────────────────────────────────────────────────

const HISTORY_ANCHORS: TourAnchor[] = [
  {
    selector: '[data-tour="history-search"]',
    title: 'Find a test',
    description: 'Search your saved tests by the website address you tested.',
  },
  {
    selector: '[data-tour="history-sort"]',
    title: 'Sort your tests',
    description: 'Order the list by Date, Severity, or Status, then use the arrow to flip between ascending and descending.',
    align: 'end',
  },
  {
    selector: '[data-tour="history-filters"]',
    title: 'Filter by severity',
    description: 'Narrow the list to tests whose findings hit a given severity.',
    align: 'end',
  },
  {
    selector: '[data-tour="history-list"]',
    title: 'Open a report',
    description: 'Select any saved test to reopen its full report, with findings, network, and console.',
  },
];

export function buildHistoryTourSteps(_isCompact: boolean): DriveStep[] {
  const welcome = welcomeStep(
    'Your saved tests',
    'Every test you save lands here so you can reopen it and review what BugSafari found.',
  );
  return assemble(welcome, HISTORY_ANCHORS);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings tour (on demand via the Help control)
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_ANCHORS: TourAnchor[] = [
  {
    selector: '[data-tour="settings-account"]',
    title: 'Your account',
    description: 'Your profile, password, and sign-out live here.',
    side: 'top',
  },
  {
    selector: '[data-tour="settings-app"]',
    title: 'Appearance and behavior',
    description: 'Switch between light and dark themes, and turn notifications and auto-save on or off.',
    side: 'top',
  },
];

export function buildSettingsTourSteps(_isCompact: boolean): DriveStep[] {
  const welcome = welcomeStep(
    'Settings',
    'Manage your account and choose how BugSafari looks and behaves on this device.',
  );
  return assemble(welcome, SETTINGS_ANCHORS);
}
