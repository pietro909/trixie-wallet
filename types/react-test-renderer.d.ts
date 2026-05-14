// Minimal type shim for `react-test-renderer` 19.x — the official
// @types/react-test-renderer package is deprecated for React 19 and DefinitelyTyped no
// longer ships matching declarations. We only consume `create`, `act`, and
// `ReactTestRenderer.unmount` inside Jest tests, so a narrow surface keeps
// `tsc --noEmit` happy without inviting drift against the real API.

declare module "react-test-renderer" {
  import type { ReactElement } from "react";

  export type ReactTestRenderer = {
    unmount(): void;
    toJSON(): unknown;
    root: unknown;
  };

  export function create(element: ReactElement): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<void>;

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };

  export default TestRenderer;
}
