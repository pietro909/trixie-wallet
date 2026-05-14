import { useCallback, useEffect, useRef, useState } from "react";
import { recordError } from "../services/diagnostics/recorder";

export type LnurlSession = {
  /** LNURL bech32 string to display/share */
  lnurl: string;
  /** Whether the SSE session is active */
  active: boolean;
  /** Error message if session failed */
  error: string | undefined;
};

export type LnurlInvoiceRequest = {
  amountMsat: number;
  comment?: string;
};

export type LnurlInvoiceHandler = (req: LnurlInvoiceRequest) => Promise<string>;

/**
 * Hook that manages an LNURL receive session with lnurl-server.
 *
 * Opens an SSE stream via `POST {lnurlServerUrl}/lnurl/session` and reads
 * raw line-by-line with `response.body.getReader()` + `TextDecoder` — the
 * `EventSource` API is unavailable in React Native / Hermes.
 *
 * Lifecycle:
 *  - on `session_created`: stash sessionId + bearer token, expose `lnurl`
 *    and mark the session `active`.
 *  - on `invoice_request`: call `onInvoiceRequest` and POST the returned
 *    bolt11 (or `{ error }` on failure) back to
 *    `/lnurl/session/{sessionId}/invoice`.
 *  - on unmount: abort the in-flight fetch; the SSE stream tears down.
 *
 * The handler is kept in a ref so the latest closure runs even when the
 * effect does not re-subscribe.
 */
export function useLnurlSession(
  enabled: boolean,
  lnurlServerUrl: string | null,
  onInvoiceRequest: LnurlInvoiceHandler,
): LnurlSession {
  const [lnurl, setLnurl] = useState("");
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const sessionIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const onInvoiceRequestRef = useRef(onInvoiceRequest);
  onInvoiceRequestRef.current = onInvoiceRequest;

  const baseUrl = lnurlServerUrl ? lnurlServerUrl.replace(/\/+$/, "") : null;

  const authHeaders = useCallback(
    () => ({
      "Content-Type": "application/json",
      ...(tokenRef.current
        ? { Authorization: `Bearer ${tokenRef.current}` }
        : {}),
    }),
    [],
  );

  const postInvoice = useCallback(
    async (sessionId: string, pr: string, signal: AbortSignal) => {
      if (!baseUrl) throw new Error("LNURL server URL is not configured");
      const response = await fetch(
        `${baseUrl}/lnurl/session/${sessionId}/invoice`,
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ pr }),
          signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to post invoice: ${response.status}`);
      }
    },
    [baseUrl, authHeaders],
  );

  const postError = useCallback(
    async (sessionId: string, reason: string, signal: AbortSignal) => {
      if (!baseUrl) return;
      try {
        const response = await fetch(
          `${baseUrl}/lnurl/session/${sessionId}/invoice`,
          {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ error: reason }),
            signal,
          },
        );
        if (!response.ok) {
          recordError(
            "receive",
            `lnurl_post_error_failed: status=${response.status}`,
          );
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          recordError(
            "receive",
            `lnurl_post_error_failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
    [baseUrl, authHeaders],
  );

  useEffect(() => {
    if (!enabled || !baseUrl) return;

    const abort = new AbortController();

    const connect = async () => {
      try {
        const response = await fetch(`${baseUrl}/lnurl/session`, {
          method: "POST",
          signal: abort.signal,
        });

        if (!response.ok || !response.body) {
          setError("Failed to open LNURL session");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let eventType = "";

        let streamClosed = false;
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            streamClosed = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ") && eventType) {
              let data: Record<string, unknown>;
              try {
                data = JSON.parse(line.slice(6));
              } catch {
                recordError("receive", "lnurl_sse_parse_failed");
                eventType = "";
                continue;
              }

              if (eventType === "session_created") {
                sessionIdRef.current = data.sessionId as string;
                tokenRef.current = data.token as string;
                setLnurl(data.lnurl as string);
                setActive(true);
                setError(undefined);
              } else if (eventType === "invoice_request") {
                const sessionId = sessionIdRef.current;
                if (!sessionId) break;

                const amountMsat = Number(data.amountMsat);
                if (!amountMsat || amountMsat <= 0) {
                  recordError(
                    "receive",
                    `lnurl_invoice_request_invalid_amount: ${amountMsat}`,
                  );
                  await postError(sessionId, "Invalid amount", abort.signal);
                  eventType = "";
                  continue;
                }
                try {
                  const pr = await onInvoiceRequestRef.current({
                    amountMsat,
                    comment: data.comment as string | undefined,
                  });
                  await postInvoice(sessionId, pr, abort.signal);
                } catch (err) {
                  const reason =
                    err instanceof Error
                      ? err.message
                      : "Failed to create invoice";
                  recordError(
                    "receive",
                    `lnurl_invoice_request_failed: ${reason}`,
                  );
                  await postError(sessionId, reason, abort.signal);
                }
              }

              eventType = "";
            }
          }
        }
        // A clean stream close without an abort means the server (or an
        // intermediate proxy) hung up on us. Surface a disconnect error so
        // the screen does not sit on the "Opening LNURL session…" spinner
        // forever waiting for events that will never arrive.
        if (streamClosed && !abort.signal.aborted) {
          recordError("receive", "lnurl_session_closed_by_server");
          setError("LNURL session disconnected");
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          recordError(
            "receive",
            `lnurl_session_error: ${err instanceof Error ? err.message : String(err)}`,
          );
          setError("LNURL session disconnected");
        }
      } finally {
        setActive(false);
        setLnurl("");
        sessionIdRef.current = null;
        tokenRef.current = null;
      }
    };

    void connect();

    return () => {
      abort.abort();
    };
  }, [enabled, baseUrl, postInvoice, postError]);

  return { lnurl, active, error };
}
