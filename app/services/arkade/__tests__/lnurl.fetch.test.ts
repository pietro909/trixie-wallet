import {
  fetchLnurlInvoice,
  fetchLnurlParams,
  type LnurlPayParams,
} from "../lnurl";

// Mocked-fetch tests for the LNURL network layer. The pure helpers
// (identifier detection, endpoint resolution, sat rounding, metadata
// parsing) live in `lnurl.test.ts`; this file targets the validation
// branches of `fetchLnurlParams` / `fetchLnurlInvoice` and the
// AbortController plumbing through `timedFetchJson`.

type FetchInit = { signal?: AbortSignal };
type FetchMock = jest.Mock<Promise<unknown>, [string, FetchInit?]>;

let fetchMock: FetchMock;
const originalFetch = globalThis.fetch;

const mockJson = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const mockJsonOnce = (body: unknown, status?: number) =>
  fetchMock.mockResolvedValueOnce(mockJson(body, status));

// A fetch that never resolves until the caller's AbortSignal fires. Used to
// exercise the external-abort and timeout paths without real wall-clock waits.
const mockAbortableFetch = () =>
  fetchMock.mockImplementationOnce(
    (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      }),
  );

beforeEach(() => {
  fetchMock = jest.fn() as FetchMock;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchLnurlParams", () => {
  const validResponse = {
    tag: "payRequest",
    callback: "https://pay.example.com/cb",
    minSendable: 1000,
    maxSendable: 100_000_000,
    metadata: '[["text/plain","Pay alice"]]',
    commentAllowed: 100,
  };

  // FP-1 — happy path. Locks the field shape and the resolver's domain /
  // identifier passthrough.
  it("FP-1: resolves a Lightning Address to a parsed pay-request", async () => {
    mockJsonOnce(validResponse);
    const params = await fetchLnurlParams("alice@example.com");
    expect(params).toMatchObject({
      callback: validResponse.callback,
      minSendable: 1000,
      maxSendable: 100_000_000,
      metadata: validResponse.metadata,
      commentAllowed: 100,
      domain: "example.com",
      identifier: "alice@example.com",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.com/.well-known/lnurlp/alice",
    );
  });

  // FP-2 — `status: "ERROR"` propagates the reason (or "Unknown" when missing).
  it.each([
    ["Custom reason", "LNURL endpoint error: Custom reason"],
    [undefined, "LNURL endpoint error: Unknown"],
  ])("FP-2: status=ERROR reason=%p throws %p", async (reason, expected) => {
    mockJsonOnce({ status: "ERROR", reason });
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      expected,
    );
  });

  // FP-3 — Non-payRequest tags are rejected so we don't misroute withdraw
  // or auth flows into the pay code path.
  it("FP-3: a non-payRequest tag is rejected", async () => {
    mockJsonOnce({ ...validResponse, tag: "withdrawRequest" });
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      "Unsupported LNURL tag: withdrawRequest",
    );
  });

  // FP-4 — Callback is required for the invoice fetch step; missing or
  // non-string callback is a malformed response.
  it("FP-4: missing callback throws", async () => {
    const { callback: _omit, ...withoutCallback } = validResponse;
    mockJsonOnce(withoutCallback);
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      "LNURL response missing callback",
    );
  });

  // FP-5 — Both "missing" (wrong type) and "invalid range" surfaces.
  it.each([
    [{ minSendable: undefined }, "LNURL response missing min/max sendable"],
    [{ maxSendable: "string" }, "LNURL response missing min/max sendable"],
    [{ minSendable: 0 }, "LNURL response has invalid min/max range"],
    [
      { minSendable: 1000, maxSendable: 500 },
      "LNURL response has invalid min/max range",
    ],
  ])("FP-5: bad min/max %p throws %p", async (override: Record<
    string,
    unknown
  >, expected) => {
    mockJsonOnce({ ...validResponse, ...override });
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      expected,
    );
  });

  // FP-6 — `commentAllowed` is only kept when it's a positive number (LUD-12
  // gate); anything else maps to `undefined` so callers don't accidentally
  // send a comment to an endpoint that doesn't advertise the field.
  it.each([
    [100, 100],
    [0, undefined],
    ["bogus", undefined],
    [undefined, undefined],
  ])("FP-6: commentAllowed=%p maps to %p", async (input, expected) => {
    mockJsonOnce({ ...validResponse, commentAllowed: input });
    const params = await fetchLnurlParams("alice@example.com");
    expect(params.commentAllowed).toBe(expected);
  });

  // FP-7 — HTTP errors surface with the status code so the UI can hint.
  it("FP-7: non-2xx response throws with the HTTP status", async () => {
    mockJsonOnce({}, 500);
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      "LNURL endpoint returned HTTP 500",
    );
  });

  // FP-8 — Distinguishes "valid response shape we don't like" from "JSON
  // didn't parse at all".
  it("FP-8: malformed JSON is surfaced distinctly", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    });
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      "LNURL endpoint returned malformed JSON",
    );
  });

  // FP-9 — Generic network errors collapse to a single user-facing message.
  it("FP-9: a generic fetch failure throws 'endpoint unreachable'", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await expect(fetchLnurlParams("alice@example.com")).rejects.toThrow(
      "LNURL endpoint unreachable",
    );
  });

  // FP-10 — Pins the cleanup contract added in b4e8f07: an external abort
  // (e.g. screen unmount) must cancel the in-flight fetch, not just discard
  // the result.
  it("FP-10: an external abort cancels the in-flight fetch", async () => {
    mockAbortableFetch();
    const controller = new AbortController();
    const promise = fetchLnurlParams("alice@example.com", controller.signal);
    // Fire the abort on the next microtask so the fetch is in flight.
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow("LNURL request aborted");
  });

  // FP-11 — A signal that's already aborted short-circuits BEFORE any fetch
  // call. This catches the path where the caller passes a reused / stale
  // controller without the runtime burning a network round-trip.
  it("FP-11: a pre-aborted signal short-circuits before fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchLnurlParams("alice@example.com", controller.signal),
    ).rejects.toThrow("LNURL request aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // FP-12 — Invalid identifiers fail fast: no network call, clear error.
  it("FP-12: an unrecognised identifier throws without calling fetch", async () => {
    await expect(fetchLnurlParams("not-an-identifier")).rejects.toThrow(
      "Not a valid LNURL identifier",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchLnurlInvoice", () => {
  const params: LnurlPayParams = {
    callback: "https://pay.example.com/cb",
    minSendable: 1000, //          1 sat in msat
    maxSendable: 100_000_000, // 100k sats in msat
    metadata: "[]",
    commentAllowed: 50,
    domain: "pay.example.com",
    identifier: "alice@example.com",
  };

  // FI-1 — happy path. Verifies the callback URL is built correctly and
  // that a missing comment doesn't add an empty `comment` query param.
  it("FI-1: returns the invoice and shapes the callback URL", async () => {
    mockJsonOnce({ pr: "lnbc1somefakeinvoice" });
    const invoice = await fetchLnurlInvoice(params, 5000);
    expect(invoice).toBe("lnbc1somefakeinvoice");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://pay.example.com/cb");
    expect(url.searchParams.get("amount")).toBe("5000000");
    expect(url.searchParams.has("comment")).toBe(false);
  });

  // FI-2 — Range guard fires before any network call. The msat conversion
  // must not let the user submit an amount the endpoint would reject.
  it.each([
    [0, "below"],
    [200_000, "above"],
  ])("FI-2: rejects %i sats (%s range) without calling fetch", async (sats) => {
    await expect(fetchLnurlInvoice(params, sats)).rejects.toThrow(
      "Amount is outside the LNURL sendable range",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // FI-3 — A bad `callback` URL in the params must fail with a precise
  // message, not the generic "endpoint unreachable" from a fetch error.
  it("FI-3: rejects a malformed callback URL without calling fetch", async () => {
    await expect(
      fetchLnurlInvoice({ ...params, callback: "not a url" }, 5000),
    ).rejects.toThrow("LNURL callback URL is malformed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // FI-4 — `status: "ERROR"` on the callback response, parametric over
  // with-reason / missing-reason.
  it.each([
    ["Insufficient liquidity", "LNURL callback error: Insufficient liquidity"],
    [undefined, "LNURL callback error: Unknown"],
  ])("FI-4: callback status=ERROR reason=%p throws %p", async (reason, expected) => {
    mockJsonOnce({ status: "ERROR", reason });
    await expect(fetchLnurlInvoice(params, 5000)).rejects.toThrow(expected);
  });

  // FI-5 — `pr` must be a non-empty string. Both the missing and empty
  // cases collapse to one error so the UI doesn't need two branches.
  it.each([
    [{}],
    [{ pr: "" }],
  ])("FI-5: response %p throws missing-invoice", async (body) => {
    mockJsonOnce(body);
    await expect(fetchLnurlInvoice(params, 5000)).rejects.toThrow(
      "LNURL callback did not return an invoice",
    );
  });

  // FI-6 — Comments are forwarded only when `commentAllowed > 0` (LUD-12).
  it("FI-6: forwards a comment when the endpoint advertises commentAllowed", async () => {
    mockJsonOnce({ pr: "lnbc1ok" });
    await fetchLnurlInvoice(params, 5000, "hello");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("comment")).toBe("hello");
  });

  // FI-7 — Comments longer than `commentAllowed` are sliced. Defense in
  // depth: the SendAmount input also slices on every keystroke, but if a
  // caller bypasses that we still don't let an over-long comment hit the
  // network.
  it("FI-7: slices a comment longer than commentAllowed", async () => {
    mockJsonOnce({ pr: "lnbc1ok" });
    await fetchLnurlInvoice(
      { ...params, commentAllowed: 5 },
      5000,
      "hello world",
    );
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("comment")).toBe("hello");
  });

  // FI-8 — When the endpoint did not advertise LUD-12 (`commentAllowed`
  // undefined), even a non-empty user comment must not be sent.
  it("FI-8: omits the comment when commentAllowed is undefined", async () => {
    mockJsonOnce({ pr: "lnbc1ok" });
    await fetchLnurlInvoice(
      { ...params, commentAllowed: undefined },
      5000,
      "hi",
    );
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.has("comment")).toBe(false);
  });

  // FI-9 — Mirrors FP-10 on the callback side.
  it("FI-9: an external abort cancels the in-flight callback fetch", async () => {
    mockAbortableFetch();
    const controller = new AbortController();
    const promise = fetchLnurlInvoice(
      params,
      5000,
      undefined,
      controller.signal,
    );
    await Promise.resolve();
    controller.abort();
    await expect(promise).rejects.toThrow("LNURL request aborted");
  });
});
