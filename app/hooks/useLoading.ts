import { useCallback, useState } from "react";

type UseLoadingReturn = {
  isLoading: boolean;
  message: string | undefined;
  show: (msg?: string) => void;
  hide: () => void;
  runAsync: <T>(
    fn: () => Promise<T>,
    opts?: { message?: string; onError?: (e: unknown) => void },
  ) => Promise<T | undefined>;
};

export function useLoading(): UseLoadingReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const show = useCallback((msg?: string) => {
    setMessage(msg);
    setIsLoading(true);
  }, []);

  const hide = useCallback(() => {
    setIsLoading(false);
    setMessage(undefined);
  }, []);

  const runAsync = useCallback(
    async <T>(
      fn: () => Promise<T>,
      opts?: { message?: string; onError?: (e: unknown) => void },
    ): Promise<T | undefined> => {
      show(opts?.message);
      try {
        return await fn();
      } catch (e) {
        opts?.onError?.(e);
        return undefined;
      } finally {
        hide();
      }
    },
    [show, hide],
  );

  return { isLoading, message, show, hide, runAsync };
}
