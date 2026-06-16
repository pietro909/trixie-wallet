// Minimal SDK stand-ins. `DigestMismatchError` is matched by `instanceof`;
// `maybeArkError` is driven per-test to simulate arkd's name/code contracts.
const mockMaybeArkError = jest.fn();

jest.mock("@arkade-os/sdk", () => ({
  DigestMismatchError: class DigestMismatchError extends Error {
    constructor(message = "DIGEST_MISMATCH") {
      super(message);
      this.name = "DigestMismatchError";
    }
  },
  maybeArkError: (e: unknown) => mockMaybeArkError(e),
}));

import { DigestMismatchError } from "@arkade-os/sdk";
import {
  ArkadeError,
  classifyCompatibilityError,
  isBuildVersionTooOldError,
  isDigestMismatchError,
} from "../errors";

beforeEach(() => {
  mockMaybeArkError.mockReset();
  mockMaybeArkError.mockReturnValue(undefined);
});

describe("isDigestMismatchError", () => {
  it("detects a raw DigestMismatchError", () => {
    expect(
      isDigestMismatchError(new DigestMismatchError("DIGEST_MISMATCH")),
    ).toBe(true);
  });

  it("detects a DigestMismatchError wrapped in ArkadeError.cause", () => {
    const wrapped = new ArkadeError(
      "send_failed",
      "Send failed",
      new DigestMismatchError("DIGEST_MISMATCH"),
    );
    expect(isDigestMismatchError(wrapped)).toBe(true);
  });

  it("detects a DigestMismatchError nested two levels deep", () => {
    const inner = new ArkadeError(
      "refresh_failed",
      "refresh",
      new DigestMismatchError("DIGEST_MISMATCH"),
    );
    const outer = new ArkadeError("send_failed", "send", inner);
    expect(isDigestMismatchError(outer)).toBe(true);
  });

  it("is false for unrelated errors", () => {
    expect(isDigestMismatchError(new Error("nope"))).toBe(false);
    expect(isDigestMismatchError(null)).toBe(false);
    expect(isDigestMismatchError("DIGEST_MISMATCH")).toBe(false);
  });
});

describe("isBuildVersionTooOldError", () => {
  it("detects via ArkError name", () => {
    const raw = new Error("BUILD_VERSION_TOO_OLD (48): too old");
    mockMaybeArkError.mockImplementation((e) =>
      e === raw ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );
    expect(isBuildVersionTooOldError(raw)).toBe(true);
  });

  it("detects via ArkError code 48 even when the name differs", () => {
    const raw = new Error("guard");
    mockMaybeArkError.mockImplementation((e) =>
      e === raw ? { name: "SOMETHING_ELSE", code: 48 } : undefined,
    );
    expect(isBuildVersionTooOldError(raw)).toBe(true);
  });

  it("detects a build-version error wrapped in ArkadeError.cause", () => {
    const raw = new Error("BUILD_VERSION_TOO_OLD (48): too old");
    const wrapped = new ArkadeError("server_unreachable", "unreachable", raw);
    mockMaybeArkError.mockImplementation((e) =>
      e === raw ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );
    expect(isBuildVersionTooOldError(wrapped)).toBe(true);
  });

  it("is false when maybeArkError yields nothing across the chain", () => {
    mockMaybeArkError.mockReturnValue(undefined);
    const wrapped = new ArkadeError(
      "server_unreachable",
      "unreachable",
      new Error("dns"),
    );
    expect(isBuildVersionTooOldError(wrapped)).toBe(false);
  });
});

describe("classifyCompatibilityError", () => {
  it("returns update_required when build-version outranks a digest mismatch", () => {
    // An error that looks like both: update-required must win.
    const raw = new DigestMismatchError("DIGEST_MISMATCH");
    mockMaybeArkError.mockImplementation((e) =>
      e === raw ? { name: "BUILD_VERSION_TOO_OLD", code: 48 } : undefined,
    );
    expect(classifyCompatibilityError(raw)).toEqual({
      kind: "update_required",
    });
  });

  it("returns digest_mismatch for a plain digest error", () => {
    expect(
      classifyCompatibilityError(new DigestMismatchError("DIGEST_MISMATCH")),
    ).toEqual({
      kind: "digest_mismatch",
    });
  });

  it("returns null for unrelated errors", () => {
    expect(classifyCompatibilityError(new Error("x"))).toBeNull();
  });
});
