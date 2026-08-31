// Info-icon notice beside every reproduction header. Clarifies the steps are what
// BugSafari did when the issue was detected, not a guaranteed exact/complete
// reproduction sequence. Thin wrapper over the shared InfoNotice affordance.

import InfoNotice from './InfoNotice';

const NOTICE =
  'These are the actions BugSafari performed when the issue was detected. Use them as a guide for investigating and reproducing the problem; they may not represent the exact or complete reproduction sequence.';

export default function ReproNotice() {
  return (
    <InfoNotice ariaLabel="About these reproduction steps" title="About these steps">
      {NOTICE}
    </InfoNotice>
  );
}
