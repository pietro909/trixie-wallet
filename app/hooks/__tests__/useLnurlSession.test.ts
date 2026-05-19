import * as React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";
import {
  type LnurlInvoiceHandler,
  type LnurlSession,
  useLnurlSession,
} from "../useLnurlSession";

// The SSE session POST uses expo/fetch (streaming-capable); invoice sub-requests
// use the global fetch. Mock them separately so each test can drive the stream
// independently of the invoice traffic.
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));

import { fetch as expoFetch } from "expo/fetch";

// We exercise the hook through a tiny wrapper component because the SSE
// reader loop runs inside a useEffect — render the hook for real, drive a
// ReadableStream the test owns, and assert against both the hook's state
// and the fetch traffic.

const ENC = new TextEncoder();
const BASE = "https://lnurl.test";
const INVOICE_URL_RE = /\/lnurl\/session\/.*\/invoice$/;

const SESSION_EVENT =
  'event: session_created\ndata: {"sessionId":"sid-1","lnurl":"LNURL1ABC","token":"tok-1"}\n\n';

type FetchCall = { url: string; init: RequestInit | undefined };

type Harness = {
  sessionFetchCall: () =>
    | { url: string; init: RequestInit | undefined }
    | undefined;
  fetchCalls: FetchCall[];
  enqueue: (chunk: string) => Promise<void>;
  closeStream: () => Promise<void>;
  invoicePostBodies: () => Promise<Array<Record<string, unknown>>>;
  unmount: () => Promise<void>;
};

function setupHarness(args: {
  handler: LnurlInvoiceHandler;
  enabled?: boolean;
  serverUrl?: string | null;
  invoicePostStatus?: number;
}): { harness: Harness; getSession: () => LnurlSession } {
  const enabled = args.enabled ?? true;
  const serverUrl = args.serverUrl === undefined ? BASE : args.serverUrl;
  const invoicePostStatus = args.invoicePostStatus ?? 200;
  const fetchCalls: FetchCall[] = [];

  // A single SSE stream backs the expo/fetch session POST. Subsequent
  // fetches (invoice POSTs) go through globalThis.fetch and resolve to
  // plain ok responses without a body.
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  // expo/fetch backs the SSE session stream
  const sessionCalls: { url: string; init: RequestInit | undefined }[] = [];
  (
    expoFetch as unknown as jest.MockedFunction<typeof fetch>
  ).mockImplementation(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    sessionCalls.push({ url, init });
    // Construct a Response with the readable stream as body. Cast via unknown
    // because lib.dom's Response type does not accept a ReadableStream<Uint8Array>
    // in its constructor signature even though the runtime supports it.
    return new Response(stream as unknown as BodyInit, { status: 200 });
  });

  // global fetch backs the invoice sub-requests
  globalThis.fetch = jest.fn(async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push({ url, init });
    return new Response("", { status: invoicePostStatus });
  }) as unknown as typeof fetch;

  let latest: LnurlSession = { lnurl: "", active: false, error: undefined };
  const Hook = (props: {
    enabled: boolean;
    serverUrl: string | null;
    handler: LnurlInvoiceHandler;
  }) => {
    latest = useLnurlSession(props.enabled, props.serverUrl, props.handler);
    return null;
  };

  let renderer!: ReactTestRenderer;
  // Wrap initial mount in act so the effect fires and the initial fetch is
  // dispatched before the test resumes.
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(Hook, {
        enabled,
        serverUrl,
        handler: args.handler,
      }),
    );
  });

  const enqueue = async (chunk: string) => {
    await act(async () => {
      streamController.enqueue(ENC.encode(chunk));
      // Let the reader loop drain the chunk, run the handler, post-back, etc.
      await flushMicrotasks();
    });
  };

  const closeStream = async () => {
    await act(async () => {
      streamController.close();
      await flushMicrotasks();
    });
  };

  const invoicePostBodies = async () => {
    const out: Array<Record<string, unknown>> = [];
    for (const call of fetchCalls) {
      if (
        INVOICE_URL_RE.test(call.url) &&
        typeof call.init?.body === "string"
      ) {
        out.push(JSON.parse(call.init.body as string));
      }
    }
    return out;
  };

  const unmount = async () => {
    await act(async () => {
      renderer.unmount();
      await flushMicrotasks();
    });
  };

  return {
    harness: {
      sessionFetchCall: () => sessionCalls[0],
      fetchCalls,
      enqueue,
      closeStream,
      invoicePostBodies,
      unmount,
    },
    getSession: () => latest,
  };
}

async function flushMicrotasks() {
  // Two ticks: the reader.read() resolves on one, the loop body runs and
  // posts a follow-up promise (handler / postInvoice) on the next.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("useLnurlSession", () => {
  // L-1: a session_created event drives the hook from idle → active and
  // exposes the lnurl string the screen should render in the QR code.
  it("L-1: session_created sets lnurl and active", async () => {
    const handler = jest.fn();
    const { harness, getSession } = setupHarness({ handler });

    await harness.enqueue(SESSION_EVENT);

    const s = getSession();
    expect(s.active).toBe(true);
    expect(s.lnurl).toBe("LNURL1ABC");
    expect(s.error).toBeUndefined();
    expect(harness.sessionFetchCall()?.url).toBe(`${BASE}/lnurl/session`);
    expect(harness.sessionFetchCall()?.init?.method).toBe("POST");

    await harness.unmount();
  });

  // L-2: invoice_request invokes the supplied handler and posts the
  // returned bolt11 back to /invoice with bearer auth.
  it("L-2: invoice_request calls the handler and posts {pr} with bearer auth", async () => {
    const handler = jest.fn(async ({ amountMsat }) => {
      expect(amountMsat).toBe(50_000);
      return "lnbcrt500n1invoice";
    });
    const { harness } = setupHarness({ handler });

    await harness.enqueue(SESSION_EVENT);
    await harness.enqueue(
      'event: invoice_request\ndata: {"amountMsat":50000}\n\n',
    );

    expect(handler).toHaveBeenCalledTimes(1);
    const bodies = await harness.invoicePostBodies();
    expect(bodies).toEqual([{ pr: "lnbcrt500n1invoice" }]);

    const invoiceCall = harness.fetchCalls.find((c) =>
      INVOICE_URL_RE.test(c.url),
    );
    const headers = invoiceCall?.init?.headers as Record<string, string>;
    expect(headers?.Authorization).toBe("Bearer tok-1");
    expect(headers?.["Content-Type"]).toBe("application/json");

    await harness.unmount();
  });

  // L-3: a handler failure is caught and reported back to lnurl-server as
  // an {error} body so the payer sees a clean failure rather than hanging.
  it("L-3: handler failure posts {error} back to /invoice", async () => {
    const handler = jest.fn(async () => {
      throw new Error("boom");
    });
    const { harness } = setupHarness({ handler });

    await harness.enqueue(SESSION_EVENT);
    await harness.enqueue(
      'event: invoice_request\ndata: {"amountMsat":50000}\n\n',
    );

    const bodies = await harness.invoicePostBodies();
    expect(bodies).toEqual([{ error: "boom" }]);

    await harness.unmount();
  });

  // L-4: an invoice_request with a non-positive amountMsat is rejected
  // without invoking the handler, and lnurl-server is told the amount
  // was invalid.
  it("L-4: zero or missing amountMsat posts {error: 'Invalid amount'} without calling the handler", async () => {
    const handler = jest.fn();
    const { harness } = setupHarness({ handler });

    await harness.enqueue(SESSION_EVENT);
    await harness.enqueue('event: invoice_request\ndata: {"amountMsat":0}\n\n');

    expect(handler).not.toHaveBeenCalled();
    const bodies = await harness.invoicePostBodies();
    expect(bodies).toEqual([{ error: "Invalid amount" }]);

    await harness.unmount();
  });

  // L-5: a clean server-side close (`done === true`) must move the hook
  // to an error state — otherwise the screen sits on the spinner forever
  // waiting for events that will never arrive.
  it("L-5: clean stream close surfaces 'LNURL session disconnected' error", async () => {
    const handler = jest.fn();
    const { harness, getSession } = setupHarness({ handler });

    await harness.enqueue(SESSION_EVENT);
    expect(getSession().active).toBe(true);

    await harness.closeStream();

    const s = getSession();
    expect(s.error).toBe("LNURL session disconnected");
    expect(s.active).toBe(false);
    expect(s.lnurl).toBe("");

    await harness.unmount();
  });

  // L-6: unmount aborts the in-flight session fetch via the
  // AbortController so the SSE stream is actually released.
  it("L-6: unmount aborts the session fetch", async () => {
    const handler = jest.fn();
    const { harness } = setupHarness({ handler });

    await harness.enqueue(SESSION_EVENT);
    const signal = harness.sessionFetchCall()?.init?.signal as
      | AbortSignal
      | undefined;
    expect(signal?.aborted).toBe(false);

    await harness.unmount();
    expect(signal?.aborted).toBe(true);
  });

  // L-7: enabled=false short-circuits the effect entirely — no fetch is
  // issued, useful when a screen wants to gate the hook behind a feature
  // flag or a still-loading network selector.
  it("L-7: disabled hook does not issue any fetches", async () => {
    const handler = jest.fn();
    const { harness, getSession } = setupHarness({ handler, enabled: false });

    // Give the effect a chance to run if it were going to.
    await act(async () => {
      await flushMicrotasks();
    });

    expect(harness.sessionFetchCall()).toBeUndefined();
    expect(harness.fetchCalls).toHaveLength(0);
    expect(getSession().active).toBe(false);
    expect(getSession().lnurl).toBe("");

    await harness.unmount();
  });
});
