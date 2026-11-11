import { ask } from '../../lib/messages';

//one touch per this many ms is enough for minute based auto lock
const touchEveryMs = 20000;

//reports clicks and key presses to the background so the auto lock counts real use only
export function watchActivity(): () => void {
  let last = 0;
  const onUse = () => {
    const now = Date.now();
    if (now - last > touchEveryMs) {
      last = now;
      ask('touch').catch(() => {});
    }
  };
  document.addEventListener('pointerdown', onUse, true);
  document.addEventListener('keydown', onUse, true);
  return () => {
    document.removeEventListener('pointerdown', onUse, true);
    document.removeEventListener('keydown', onUse, true);
  };
}
