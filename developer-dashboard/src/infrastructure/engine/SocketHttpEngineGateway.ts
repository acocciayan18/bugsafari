import { io, type Socket } from 'socket.io-client';
import type { EngineGateway } from '../../application/ports/EngineGateway';
import type { EngineMilestone, ForensicCrashReport, IncidentReport, TelemetryEvent } from '../../types';



type ConnectedHandler = (connected: boolean) => void;
type TelemetryHandler = (event: TelemetryEvent) => void;
type ForensicHandler = (report: ForensicCrashReport) => void;
type IncidentHandler = (report: IncidentReport) => void;
type FrameHandler = (base64Jpeg: string) => void;
type EngineMilestoneHandler = (milestone: EngineMilestone) => void;
type UrlChangedHandler = (url: string) => void;


export class SocketHttpEngineGateway implements EngineGateway {
  private readonly apiBaseUrl: string;
  private readonly socket: Socket;

  private connectedHandler: ConnectedHandler | null = null;
  private telemetryHandler: TelemetryHandler | null = null;
  private forensicHandler: ForensicHandler | null = null;
  private incidentHandler: IncidentHandler | null = null;
  private frameHandler: FrameHandler | null = null;
  private engineMilestoneHandler: EngineMilestoneHandler | null = null;
  private urlChangedHandler: UrlChangedHandler | null = null;


  constructor(apiBaseUrl: string, socketUrl: string) {

    this.apiBaseUrl = apiBaseUrl;
    this.socket = io(socketUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 20,
      timeout: 10000,
    });
  }

  public connect(): void {
    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('telemetry', this.handleTelemetry);
    this.socket.on('forensic-report', this.handleForensicReport);
    this.socket.on('incident-report', this.handleIncidentReport);
    this.socket.on('engine-milestone', this.handleEngineMilestone);
    this.socket.on('live-frame', this.handleLiveFrame);
    this.socket.on('url-changed', this.handleUrlChanged);


    this.socket.connect();
  }

  public disconnect(): void {
    this.removeAllListeners();
    this.socket.disconnect();
  }

  public onConnected(handler: ConnectedHandler): void {
    this.connectedHandler = handler;
  }

  public onTelemetry(handler: TelemetryHandler): void {
    this.telemetryHandler = handler;
  }

  public onForensicReport(handler: ForensicHandler): void {
    this.forensicHandler = handler;
  }

  public onIncidentReport(handler: IncidentHandler): void {
    this.incidentHandler = handler;
  }

  public onEngineMilestone(handler: EngineMilestoneHandler): void {
    this.engineMilestoneHandler = handler;
  }

  public onLiveFrame(handler: FrameHandler): void {
    this.frameHandler = handler;
  }


  public removeAllListeners(): void {
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('telemetry', this.handleTelemetry);
    this.socket.off('forensic-report', this.handleForensicReport);
    this.socket.off('incident-report', this.handleIncidentReport);
    this.socket.off('engine-milestone', this.handleEngineMilestone);
    this.socket.off('live-frame', this.handleLiveFrame);

  }

  public async startTest(targetUrl: string): Promise<void> {
    const response = await fetch(`${this.apiBaseUrl}/api/start-test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  }

  private readonly handleConnect = (): void => {
    this.connectedHandler?.(true);
  };

  private readonly handleDisconnect = (): void => {
    this.connectedHandler?.(false);
  };

  private readonly handleTelemetry = (event: TelemetryEvent): void => {
    this.telemetryHandler?.(event);
  };

  private readonly handleForensicReport = (report: ForensicCrashReport): void => {
    this.forensicHandler?.(report);
  };

  private readonly handleIncidentReport = (report: IncidentReport): void => {
    this.incidentHandler?.(report);
  };

  private readonly handleEngineMilestone = (milestone: EngineMilestone): void => {
    this.engineMilestoneHandler?.(milestone);
  };

  private readonly handleLiveFrame = (base64Jpeg: string): void => {
    this.frameHandler?.(base64Jpeg);
  };

  public onUrlChanged(handler: UrlChangedHandler): void {
    this.urlChangedHandler = handler;
  }

  private readonly handleUrlChanged = (url: string): void => {
    this.urlChangedHandler?.(url);
  };
}


