export type ToastType = "success" | "error" | "info";

type ToastListener = (message: string, type: ToastType) => void;

const listeners = new Set<ToastListener>();

export const toastEmitter = {
  show: (message: string, type: ToastType = "info") => {
    for (const listener of listeners) {
      listener(message, type);
    }
  },
  addListener: (listener: ToastListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
