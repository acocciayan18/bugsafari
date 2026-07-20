// Single source for policy prose, version, and build info.
// Bump POLICY_VERSION whenever privacy/terms/disclaimer text changes materially.

export const POLICY_VERSION = '1.0.0';
export const POLICY_EFFECTIVE_DATE = 'July 2026';

export const APP_VERSION = __APP_VERSION__;
export const BUILD_TIME = __BUILD_TIME__;

export interface LegalSection {
  heading: string;
  body: string[];
  bullets?: string[];
}

export interface LegalDoc {
  id: string;
  title: string;
  summary: string;
  sections: LegalSection[];
}

export const PRIVACY_NOTICE: LegalDoc = {
  id: 'privacy',
  title: 'Privacy Notice',
  summary: `Issued under the Data Privacy Act of 2012 (Republic Act No. 10173). Version ${POLICY_VERSION}, effective ${POLICY_EFFECTIVE_DATE}.`,
  sections: [
    {
      heading: 'What we collect',
      body: ['BugSafari collects only the data required to operate autonomous exploratory testing sessions.'],
      bullets: [
        'Account data — email address and a one-way hashed password.',
        'Session data — target URLs you supply, testing configuration, and run timestamps.',
        'Telemetry — DOM element traces, action sequences, and console and network errors captured from the application you test.',
        'Technical data — browser and device information needed to serve the dashboard.',
      ],
    },
    {
      heading: 'How we use it',
      body: ['Your data is processed to execute testing runs, render live telemetry, store your session history, and generate defect reports.'],
      bullets: [
        'We do not sell, rent, or trade personal information.',
        'We do not use your data for advertising or profiling.',
        'Aggregated, de-identified metrics may inform academic research findings.',
      ],
    },
    {
      heading: 'How we protect it',
      body: ['Processing follows the security principles required by RA 10173.'],
      bullets: [
        'Passwords are hashed and never stored or transmitted in plain text.',
        'Sessions are authenticated with signed, expiring tokens.',
        'Records are isolated per account in a multi-tenant database; no account can query another account’s data.',
        'Testing executes in an isolated container that cannot reach your local files.',
        'Guest sessions are held in memory for the browser session only and are never written to the database.',
      ],
    },
    {
      heading: 'Your rights as a data subject',
      body: ['Under RA 10173 you are entitled to the following, exercisable at any time through the support channel in this application.'],
      bullets: [
        'Right to be informed of how your data is collected and processed.',
        'Right to access the personal data we hold about you.',
        'Right to object to processing, and to withdraw consent.',
        'Right to rectify inaccurate or outdated data.',
        'Right to erasure or blocking of your data.',
        'Right to data portability in a structured, machine-readable format.',
        'Right to damages for violations of your data privacy rights.',
        'Right to file a complaint with the National Privacy Commission (privacy.gov.ph).',
      ],
    },
    {
      heading: 'Retention',
      body: [
        'Session records and telemetry are retained while your account is active. Deleting your account removes the associated records. Guest data is discarded when the browser session ends.',
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDoc = {
  id: 'terms',
  title: 'Terms of Use',
  summary: `Conditions governing your use of BugSafari. Version ${POLICY_VERSION}, effective ${POLICY_EFFECTIVE_DATE}.`,
  sections: [
    {
      heading: 'Authorized testing only',
      body: [
        'BugSafari actively interacts with the application you point it at — it clicks, submits forms, injects boundary and malformed input, and can create or modify data in that application.',
      ],
      bullets: [
        'You may only test applications you own or for which you hold documented written authorization.',
        'Testing third-party systems without permission may violate the Cybercrime Prevention Act of 2012 (RA 10175) and equivalent laws elsewhere.',
        'Do not point BugSafari at production systems holding real personal data.',
        'Use a dedicated staging environment with disposable test data.',
      ],
    },
    {
      heading: 'Your responsibilities',
      body: ['By using this system you accept sole responsibility for the targets you select and the effects of testing on them.'],
      bullets: [
        'You warrant that you are authorized to test every target URL you submit.',
        'You keep your account credentials confidential.',
        'You do not use BugSafari to attack, disrupt, or gain unauthorized access to any system.',
        'You do not submit credentials or data you are not permitted to disclose.',
        'You back up any environment whose state you cannot afford to lose.',
      ],
    },
    {
      heading: 'System limitations',
      body: ['BugSafari is an exploratory testing aid, not a guarantee of correctness or security.'],
      bullets: [
        'Exploration is heuristic and adaptive — coverage is not exhaustive and results vary between runs.',
        'Absence of reported findings does not mean the application is free of defects or vulnerabilities.',
        'Reported findings may include false positives and require human verification.',
        'The system may not fully traverse applications relying on CAPTCHA, multi-factor authentication, or hardware devices.',
        'The software is provided "as is", without warranty of any kind, to the maximum extent permitted by law.',
      ],
    },
  ],
};

export const RESEARCH_DISCLAIMER: LegalDoc = {
  id: 'research',
  title: 'Research Disclaimer',
  summary: 'BugSafari is an academic research prototype.',
  sections: [
    {
      heading: 'Academic context',
      body: [
        'BugSafari was developed as an undergraduate thesis project investigating autonomous, scriptless exploratory testing for single-page applications using a single-layer perceptron and structural DOM hashing.',
        'It is released for educational purposes and for authorized security testing only.',
      ],
    },
    {
      heading: 'Not a commercial product',
      body: [
        'This prototype carries no service-level agreement, no uptime guarantee, and no commercial support. It should not be relied upon as the sole quality or security gate for any production release.',
      ],
    },
    {
      heading: 'Responsible use',
      body: [
        'The techniques implemented here — automated interaction, input fuzzing, and boundary-state probing — are dual-use. Deploying them against systems you do not own or lack authorization to test is unlawful, and the authors accept no liability for such use.',
      ],
    },
  ],
};

export const ABOUT_BUGSAFARI: LegalDoc = {
  id: 'about',
  title: 'About BugSafari',
  summary: 'Autonomous exploratory testing engine for single-page applications.',
  sections: [
    {
      heading: 'What it does',
      body: [
        'BugSafari replaces static test scripts with an agent that explores an application on its own — traversing the DOM, scoring which elements are worth interacting with, avoiding loops, fuzzing inputs, and recording the steps that led to any crash it triggers.',
      ],
    },
    {
      heading: 'How it works',
      body: ['Four mechanisms drive each run.'],
      bullets: [
        'DOM traversal and interaction driven by Playwright in an isolated container.',
        'Element prioritization by a single-layer perceptron trained online with the delta rule.',
        'Loop prevention through structural DOM hashing and state clustering.',
        'Crash forensics from a 20-step circular action buffer, replayable step by step.',
      ],
    },
    {
      heading: 'Build',
      body: [`Version ${APP_VERSION} · built ${BUILD_TIME}`, `Policy version ${POLICY_VERSION}`],
    },
  ],
};

interface LicenseEntry {
  name: string;
  license: string;
}

// Core runtime dependencies. Full transitive tree available via `npm ls --all`.
const LICENSES: LicenseEntry[] = [
  { name: 'react', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'react-router-dom', license: 'MIT' },
  { name: 'zustand', license: 'MIT' },
  { name: 'socket.io-client', license: 'MIT' },
  { name: 'lucide-react', license: 'ISC' },
  { name: 'sonner', license: 'MIT' },
  { name: 'dompurify', license: 'Apache-2.0 OR MPL-2.0' },
  { name: 'gsap', license: 'GreenSock Standard "No Charge"' },
  { name: 'ogl', license: 'MIT' },
  { name: 'vite', license: 'MIT' },
  { name: 'tailwindcss', license: 'MIT' },
  { name: 'typescript', license: 'Apache-2.0' },
  { name: 'express', license: 'MIT' },
  { name: 'playwright', license: 'Apache-2.0' },
  { name: 'socket.io', license: 'MIT' },
  { name: 'mongoose', license: 'MIT' },
];

export const OPEN_SOURCE_LICENSES: LegalDoc = {
  id: 'licenses',
  title: 'Open Source Licenses',
  summary: 'BugSafari is built on the following open source software. Each remains under its own license.',
  sections: [
    {
      heading: 'Core dependencies',
      body: [],
      bullets: LICENSES.map((entry) => `${entry.name} — ${entry.license}`),
    },
    {
      heading: 'Attribution',
      body: [
        'Full license texts ship with each package inside node_modules. Run `npm ls --all` in either workspace for the complete transitive dependency tree.',
      ],
    },
  ],
};

export const LEGAL_DOCS = {
  privacy: PRIVACY_NOTICE,
  terms: TERMS_OF_USE,
  research: RESEARCH_DISCLAIMER,
  about: ABOUT_BUGSAFARI,
  licenses: OPEN_SOURCE_LICENSES,
} as const;

export type LegalDocId = keyof typeof LEGAL_DOCS;

export const GUEST_LIMITATIONS = [
  'Your session is temporary and ends when you close this browser.',
  'Session history is not saved — past runs cannot be revisited.',
  'Reports cannot be generated, exported, or downloaded.',
  'Testing configurations and target profiles are not stored.',
  'No data is written to the database at any point.',
] as const;
