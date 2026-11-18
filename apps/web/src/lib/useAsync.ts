import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { errorMessage } from './format';

export interface AsyncState<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  reload: () => void;
}

/**
 * Runs `fn` on mount and whenever `deps` change (or `reload()` is called). Stale requests are aborted so an
 * old response can never overwrite a newer one. `loading` is derived from which request has settled, so no
 * state is set synchronously inside the effect.
 */
export function useAsync<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const [settled, setSettled] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  const key = `${JSON.stringify(deps)}#${tick}`;
  useEffect(() => {
    const controller = new AbortController();
    fnRef
      .current(controller.signal)
      .then((data) => !controller.signal.aborted && setSettled({ key, data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSettled((prev) => ({ key, data: prev.data, error: errorMessage(error) }));
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
