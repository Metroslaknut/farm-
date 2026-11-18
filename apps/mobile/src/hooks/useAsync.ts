import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { toViewError, type ViewError } from '@/api/errors';
import { useNetwork } from '@/network/NetworkProvider';

export interface AsyncState<T> {
  data: T | undefined;
  error: ViewError | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Load data with loading / error / offline handling.
 *  - stale requests are aborted, so an old response never overwrites a newer one
 *  - whenever the connection returns, the data is refreshed automatically (so an "offline" error heals itself)
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const { isOnline } = useNetwork();
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<{ key: string; data?: T; error?: ViewError }>({ key: '' });
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  // Count reconnections (adjusting state during render is the sanctioned way to react to a changed value).
  const [epoch, setEpoch] = useState(0);
  const [wasOnline, setWasOnline] = useState(isOnline);
  if (wasOnline !== isOnline) {
    setWasOnline(isOnline);
    if (isOnline) setEpoch((e) => e + 1);
  }

  const key = `${JSON.stringify(deps)}#${tick}#${epoch}`;
  useEffect(() => {
    const controller = new AbortController();
    fnRef
      .current(controller.signal)
      .then((data) => !controller.signal.aborted && setSettled({ key, data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSettled((prev) => ({ key, data: prev.data, error: toViewError(error) }));
      });
    return () => controller.abort();
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return {
    data: settled.data,
    error: settled.key === key ? settled.error : undefined,
    loading: settled.key !== key,
    reload,
  };
}
