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
    body: [
      'BugSafari collects only the data required to operate autonomous exploratory testing sessions.',
    ],
    bullets: [
      'We collect your account information (email and securely hashed password), testing session details (target URLs, configurations, and timestamps), telemetry generated during exploration (DOM interactions, action history, console and network errors), and the technical information necessary to operate the dashboard.',
    ],
  },
  {
    heading: 'How we use it',
    body: [
      'Your data is processed to execute testing runs, render live telemetry, store your session history, and generate defect reports.',
    ],
    bullets: [
      'Your data is used solely to provide BugSafari’s testing services and improve academic research through aggregated, de-identified metrics; it is never sold, rented, traded, or used for advertising or profiling.',
    ],
  },
  {
    heading: 'How we protect it',
    body: [
      'Processing follows the security principles required by RA 10173.',
    ],
    bullets: [
      'We protect your data using hashed passwords, signed and expiring authentication tokens, per-account data isolation, containerized test execution, and temporary in-memory guest sessions that are never stored in the database.',
    ],
  },
  {
    heading: 'Your rights as a data subject',
    body: [
      'Under RA 10173 you are entitled to the following, exercisable at any time through the support channel in this application.',
    ],
    bullets: [
      'You have the right to be informed, access, object to processing, withdraw consent, correct inaccurate information, request deletion or blocking of your data, obtain a portable copy of your data, seek damages for privacy violations, and file a complaint with the National Privacy Commission.',
    ],
  },
  {
    heading: 'Retention',
    body: [
      'Session records and telemetry are retained while your account is active.',
    ],
    bullets: [
      'Your session history and telemetry are retained only while your account remains active; deleting your account removes the associated records, while guest session data exists only for the current browser session and is automatically discarded afterward.',
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
      'BugSafari actively interacts with the application you point it at. It clicks, submits forms, injects boundary and malformed input, and can create or modify data in that application.',
    ],
    bullets: [
      'You may only use BugSafari on applications you own or are explicitly authorized to test, always in a dedicated staging environment with disposable test data, as unauthorized testing or targeting production systems containing real personal data may violate the Cybercrime Prevention Act of 2012 (RA 10175) and other applicable laws.',
    ],
  },
  {
    heading: 'Your responsibilities',
    body: [
      'By using this system you accept sole responsibility for the targets you select and the effects of testing on them.',
    ],
    bullets: [
      'You are responsible for ensuring you have authorization to test every submitted target, protecting your account credentials, using BugSafari only for lawful and authorized security testing, avoiding the disclosure of unauthorized credentials or sensitive data, and maintaining backups of any environment whose state is important.',
    ],
  },
  {
    heading: 'System limitations',
    body: [
      'BugSafari is an exploratory testing aid, not a guarantee of correctness or security.',
    ],
    bullets: [
      'BugSafari uses heuristic, adaptive exploration, so coverage is not exhaustive and may vary between runs; the absence of findings does not guarantee an application is defect-free, reported findings may require human verification due to possible false positives, some authentication mechanisms such as CAPTCHA, MFA, or hardware tokens may limit exploration, and the software is provided "as is" without warranty to the fullest extent permitted by law.',
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
        'The techniques implemented here (automated interaction, input fuzzing, and boundary-state probing) are dual-use. Deploying them against systems you do not own or lack authorization to test is unlawful, and the authors accept no liability for such use.',
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
        'BugSafari replaces static test scripts with an agent that explores an application on its own, traversing the DOM, scoring which elements are worth interacting with, avoiding loops, fuzzing inputs, and recording the steps that led to any crash it triggers.',
      ],
    },
    {
      heading: 'How it works',
      body: ['Four mechanisms drive each run.'],
      bullets: [
  'BugSafari performs automated DOM exploration using Playwright in an isolated container, prioritizes elements through an online-trained single-layer perceptron, prevents exploration loops with structural DOM hashing and state clustering, and captures crash forensics using a replayable related step circular action buffer.',
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
      bullets: LICENSES.map((entry) => `${entry.name}: ${entry.license}`),
    },
    {
      heading: 'Attribution',
      body: [
        'Full license texts are included with each package as distributed. Every dependency listed above remains governed by its own license terms.',
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
  'Runs are capped at 5 minutes, with one run at a time.',
  'Fewer runs are allowed, with a short wait between launches.',
  'Testing scope and scenarios are reduced and focused on the launch route.',
  'Testing behind a login (Target Auth) is disabled.',
  'Session history, reports, and share links are not available.',
  'Nothing is saved to the database at any point.',
] as const;
