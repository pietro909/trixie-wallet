import type { Activity } from "../../../store/types";
import { shouldNotify } from "../../notifications";
import { decideNotification } from "../../notifications/policy";

jest.mock("../../notifications", () => ({
  shouldNotify: jest.fn(),
}));

describe("decideNotification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("source: activity", () => {
    const mockActivity: Activity = {
      id: "act_1",
      kind: "payment",
      direction: "in",
      rail: "arkade",
      timestamp: Date.now(),
      title: "Received",
      status: "confirmed",
      source: { type: "arkade_tx", walletTxId: "tx_1" },
    };

    it("returns toast for newly appeared inbound payment when allowed", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(true);
      const result = await decideNotification({
        source: "activity",
        activity: mockActivity,
        reason: "appeared",
      });
      expect(result).toEqual({
        kind: "toast",
        message: "Payment received",
        tone: "success",
      });
      expect(shouldNotify).toHaveBeenCalledWith("payments", undefined);
    });

    it("returns none if reason is transitioned", async () => {
      const result = await decideNotification({
        source: "activity",
        activity: mockActivity,
        reason: "transitioned",
      });
      expect(result).toEqual({ kind: "none" });
    });

    it("returns none if direction is not in", async () => {
      const result = await decideNotification({
        source: "activity",
        activity: { ...mockActivity, direction: "out" },
        reason: "appeared",
      });
      expect(result).toEqual({ kind: "none" });
    });

    it("returns none if kind is not payment (e.g. wallet_event)", async () => {
      const result = await decideNotification({
        source: "activity",
        activity: { ...mockActivity, kind: "wallet_event" },
        reason: "appeared",
      });
      expect(result).toEqual({ kind: "none" });
    });

    it("returns none if payments notifications are disabled", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(false);
      const result = await decideNotification({
        source: "activity",
        activity: mockActivity,
        reason: "appeared",
      });
      expect(result).toEqual({ kind: "none" });
    });

    it("returns toast for confirmed lightning_swap", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(true);
      const result = await decideNotification({
        source: "activity",
        activity: {
          ...mockActivity,
          kind: "lightning_swap",
          status: "confirmed",
        },
        reason: "transitioned",
      });
      expect(result).toEqual({
        kind: "toast",
        message: "Payment received",
        tone: "success",
      });
    });

    it("returns toast for refunded lightning_swap", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(true);
      const result = await decideNotification({
        source: "activity",
        activity: {
          ...mockActivity,
          kind: "lightning_swap",
          status: "refunded",
        },
        reason: "appeared",
      });
      expect(result).toEqual({
        kind: "toast",
        message: "Swap refunded",
        tone: "info",
      });
    });

    it("background swap claim with notified: true (OS tray fired), then a foreground resume drain — assert no foreground re-toast", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(true);
      const result = await decideNotification({
        source: "activity",
        activity: {
          ...mockActivity,
          kind: "lightning_swap",
          status: "confirmed",
          metadata: { backgroundNotified: true },
        },
        reason: "appeared",
      });
      expect(result).toEqual({ kind: "none" });
      expect(shouldNotify).not.toHaveBeenCalled();
    });
  });

  describe("source: swap_drain", () => {
    it("returns local_notification for background context", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(true);
      const result = await decideNotification({
        source: "swap_drain",
        claimed: 1,
        refunded: 0,
        context: "background",
      });
      expect(result).toEqual({
        kind: "local_notification",
        title: "Swap completed",
        body: "Successfully claimed 1 swap.",
        channelId: "swaps",
      });
    });

    it("returns none for foreground context (handled by activity detector)", async () => {
      const result = await decideNotification({
        source: "swap_drain",
        claimed: 1,
        refunded: 0,
        context: "foreground",
      });
      expect(result).toEqual({ kind: "none" });
    });

    it("uses plural correctly in copy", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(true);
      const result = await decideNotification({
        source: "swap_drain",
        claimed: 2,
        refunded: 3,
        context: "background",
      });
      expect(result).toEqual({
        kind: "local_notification",
        title: "Swap activity",
        body: "Claimed 2 swaps, refunded 3 swaps.",
        channelId: "swaps",
      });
    });

    it("returns none if swaps notifications are disabled", async () => {
      (shouldNotify as jest.Mock).mockResolvedValue(false);
      const result = await decideNotification({
        source: "swap_drain",
        claimed: 1,
        refunded: 0,
        context: "background",
      });
      expect(result).toEqual({ kind: "none" });
    });

    it("returns none if nothing claimed or refunded", async () => {
      const result = await decideNotification({
        source: "swap_drain",
        claimed: 0,
        refunded: 0,
        context: "background",
      });
      expect(result).toEqual({ kind: "none" });
    });
  });
});
