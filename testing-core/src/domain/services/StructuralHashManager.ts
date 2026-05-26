import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

export class StructuralHashManager {
  private readonly history: string[] = [];

  public async hash(page: Page): Promise<string> {
    const snapshot = await page.evaluate(() => {
      const parts: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let current = walker.currentNode as Element | null;

      while (current) {
        const element = current as HTMLElement;
        const childrenCount = element.children.length;
        const className = element.className?.toString().slice(0, 64) ?? '';
        const signature = `${element.tagName.toLowerCase()}|${childrenCount}|${className}`;
        parts.push(signature);
        current = walker.nextNode() as Element | null;
      }

      return parts.join('>');
    });

    return createHash('sha256').update(snapshot).digest('hex');
  }

  public register(hash: string): { logicLoop: boolean; repeatCount: number } {
    this.history.push(hash);
    if (this.history.length > 8) {
      this.history.shift();
    }

    const latest = this.history.slice(-3);
    const logicLoop = latest.length === 3 && latest.every((item) => item === hash);
    const repeatCount = logicLoop ? 3 : latest.filter((item) => item === hash).length;
    return { logicLoop, repeatCount };
  }
}
