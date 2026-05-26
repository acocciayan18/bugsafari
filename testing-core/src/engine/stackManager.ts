// src/engine/stackManager.ts
import { type Page, type BrowserContext } from 'playwright';
import { TelemetryHub } from '../reporters/socketServer.js';

export class PageStackManager {
  private stack: Page[] = [];

  constructor(
    private context: BrowserContext,
    private telemetry: TelemetryHub
  ) {}

  /**
   * Initializes the stack with the primary page.
   */
  public async initialize(mainPage: Page) {
    this.push(mainPage);
    this.setupContextListener();
  }

  /**
   * Returns the page at the top of the stack (the active target).
   */
  public get activePage(): Page {
    return this.stack[this.stack.length - 1];
  }

  private push(page: Page) {
    this.stack.push(page);

    // Automatically remove from stack when the tab is closed
    page.on('close', () => {
      const index = this.stack.indexOf(page);
      if (index > -1) {
        this.stack.splice(index, 1);
        this.telemetry.emitTelemetry('ACTION', {
          actionExecuted: 'window-closed',
          message: 'Tab closed. Reverting focus to previous page in stack.',
        });
      }
    });
  }

  private setupContextListener() {
    this.context.on('page', async (newPage) => {
      this.telemetry.emitTelemetry('ACTION', {
        actionExecuted: 'new-window-detected',
        url: newPage.url(),
        message: 'Detected a new tab. Pushing to Page Stack.',
      });

      await newPage.waitForLoadState();
      this.push(newPage);
      await newPage.bringToFront();
    });
  }
}