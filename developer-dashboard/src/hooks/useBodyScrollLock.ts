import { useEffect } from 'react';

let lockCount = 0;
let restoreOverflow = '';

/** Freezes background scroll while an overlay is open. Ref-counted so nested layers compose. */
export function useBodyScrollLock(isLocked: boolean): void {
  useEffect(() => {
    if (!isLocked) return;
    if (lockCount === 0) {
      restoreOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = restoreOverflow;
    };
  }, [isLocked]);
}
