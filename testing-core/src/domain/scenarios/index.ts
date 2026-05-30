import type { Page } from 'playwright';
import type { InteractiveElement } from '../../domain/entities/InteractiveElement.js';
import type { StressScenario } from './types.js';

// Consolidated rapid clicker exports
export {
  buttonSpammer,
  coordinateBombing,
  burstClickElement,
  concurrentEventSpam,
  executeSpam,
  InteractionSimulator,
  type BurstClickResult,
} from './rapidClickerStress.js';

export { securityVulnerabilityScout } from './securityVulnerabilityScout.js';
export { formBypasser } from './formBypasser.js';
export { networkSaboteur } from './networkSaboteur.js';
export { dataFuzzer } from './dataFuzzer.js';
export { routeTrasher } from './routeTrasher.js';

import { securityVulnerabilityScout } from './securityVulnerabilityScout.js';
import { dataFuzzer } from './dataFuzzer.js';
import { buttonSpammer, coordinateBombing } from './rapidClickerStress.js';
import { routeTrasher } from './routeTrasher.js';
import { formBypasser } from './formBypasser.js';
import { networkSaboteur } from './networkSaboteur.js';

type RouteTrasherCompatibleScenario = {
  name: string;
  execute(page: Page, target?: InteractiveElement): Promise<void>;
};

const routeTrasherScenario: RouteTrasherCompatibleScenario = {
  name: routeTrasher.name,
  async execute(page: Page, target?: InteractiveElement): Promise<void> {
    await routeTrasher.execute(page, target);
  },
};

export const stressScenarioRegistry: StressScenario[] = [
  dataFuzzer,
  securityVulnerabilityScout,
  buttonSpammer,
  coordinateBombing,
  routeTrasherScenario,
  formBypasser,
  networkSaboteur,
];

export const stressScenarioMap: Record<string, StressScenario> = {
  DataFuzzer: dataFuzzer,
  SecurityVulnerabilityScout: securityVulnerabilityScout,
  ButtonSpammer: buttonSpammer,
  CoordinateBombing: coordinateBombing,
  RouteTrasher: routeTrasherScenario,
  FormBypasser: formBypasser,
  NetworkSaboteur: networkSaboteur,
};

export type { StressScenario };
