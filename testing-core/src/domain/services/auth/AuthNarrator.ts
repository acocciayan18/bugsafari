import type { TelemetryEmitter } from '../telemetry/TelemetryEmitter.js';
import {
  AUTH_ACTION,
  describeAffordanceClick,
  describeAuthFailed,
  describeAuthRetry,
  describeAuthStart,
  describeAuthSucceeded,
  describeCredentialsEntered,
  describeDiscovering,
  describeFormDetected,
  describeNavigating,
  describeRouteProbe,
  describeSubmitted,
  describeVerifying,
  safeUrl,
  type AuthPlaybookStep,
} from './authNarration.js';

/** Writes one login step into the reproduction playbook. */
export type RecordAuthStep = (step: AuthPlaybookStep) => void;

/**
 * The single voice of the target-app login. Every phase both streams a telemetry
 * ACTION and — where the step is genuinely replayable — records a value-less
 * playbook entry, so the Live Feed narration and the forensic timeline cannot
 * drift apart.
 *
 * Only three phases reach the playbook: reaching the form, entering credentials,
 * and submitting. Discovery clicks and route probes are engine search, not steps a
 * human would repeat, so they stay in telemetry only.
 */
export class AuthNarrator {
  constructor(
    private readonly telemetry: TelemetryEmitter,
    private readonly record?: RecordAuthStep,
  ) {}

  private emit(actionExecuted: string, message: string, url?: string): void {
    this.telemetry.emit('ACTION', {
      actionExecuted,
      message,
      ...(url ? { url: safeUrl(url) } : {}),
    });
  }

  public started(): void {
    this.emit(AUTH_ACTION.started, describeAuthStart());
  }

  public navigating(url: string): void {
    this.emit(AUTH_ACTION.navigating, describeNavigating(url), url);
  }

  public discovering(url: string): void {
    this.emit(AUTH_ACTION.discovering, describeDiscovering(url), url);
  }

  public affordanceClicked(name: string, url: string): void {
    this.emit(AUTH_ACTION.affordanceClicked, describeAffordanceClick(name, url), url);
  }

  public routeProbed(url: string): void {
    this.emit(AUTH_ACTION.routeProbed, describeRouteProbe(url), url);
  }

  public formDetected(url: string): void {
    this.emit(AUTH_ACTION.formDetected, describeFormDetected(url), url);
    this.record?.({
      action: 'authenticate-navigate',
      actionType: 'NAVIGATION',
      humanIdentifier: 'the target application login page',
      url: safeUrl(url),
    });
  }

  public credentialsEntered(url: string): void {
    this.emit(AUTH_ACTION.credentialsEntered, describeCredentialsEntered(), url);
    this.record?.({
      action: 'authenticate-input',
      actionType: 'INPUT',
      humanIdentifier: 'the target application login form',
      elementKind: 'field',
      url: safeUrl(url),
    });
  }

  public submitted(name: string | null, url: string): void {
    this.emit(AUTH_ACTION.submitted, describeSubmitted(name), url);
    this.record?.({
      action: 'authenticate-submit',
      actionType: 'CLICK',
      humanIdentifier: name ?? 'the login form (submitted with Enter)',
      elementKind: name ? 'button' : 'field',
      url: safeUrl(url),
    });
  }

  public verifying(): void {
    this.emit(AUTH_ACTION.verifying, describeVerifying());
  }

  public retrying(reason: string): void {
    this.emit(AUTH_ACTION.retrying, describeAuthRetry(reason));
  }

  public succeeded(url: string): void {
    this.emit(AUTH_ACTION.succeeded, describeAuthSucceeded(url), url);
  }

  public failed(reason: string): void {
    this.emit(AUTH_ACTION.failed, describeAuthFailed(reason));
  }
}
