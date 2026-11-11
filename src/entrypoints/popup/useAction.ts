import { useCallback, useRef, useState } from 'react';

//one action at a time per form: a second click or Enter while the first runs does nothing.
//The ref blocks at once, the state only updates the button on the next render.
export function useAction() {
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (running.current) {
      return false;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message || String(e));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, run };
}
