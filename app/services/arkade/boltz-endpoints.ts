import {
  BoltzSwapProvider,
  type BoltzSwapStatus,
  SwapNotFoundError,
} from "@arkade-os/boltz-swap";
import type { NetworkName } from "@arkade-os/sdk";

type GetSwapStatusResponse = Awaited<
  ReturnType<BoltzSwapProvider["getSwapStatus"]>
>;
type MonitorSwapUpdate = Parameters<BoltzSwapProvider["monitorSwap"]>[1];
type SubmarineRefundTransaction = Parameters<
  BoltzSwapProvider["refundSubmarineSwap"]
>[1];
type SubmarineRefundCheckpoint = Parameters<
  BoltzSwapProvider["refundSubmarineSwap"]
>[2];
type ChainRefundTransaction = Parameters<
  BoltzSwapProvider["refundChainSwap"]
>[1];
type ChainRefundCheckpoint = Parameters<
  BoltzSwapProvider["refundChainSwap"]
>[2];
type ChainQuoteRequest = Parameters<BoltzSwapProvider["postChainQuote"]>[1];
type ChainClaimDetailsRequest = Parameters<
  BoltzSwapProvider["postChainClaimDetails"]
>[1];

export type BoltzEndpointSource = "primary" | "legacy";

export type BoltzEndpointConfig = {
  primary: string;
  legacy: string[];
};

export type ResolvedBoltzSwapEndpoint = {
  apiUrl: string;
  source: BoltzEndpointSource;
  status: BoltzSwapStatus;
  response: GetSwapStatusResponse;
};

export type BoltzSwapEndpointNotFound = {
  kind: "not_found";
  swapId: string;
  checkedUrls: string[];
};

export const BOLTZ_ENDPOINTS: Partial<
  Record<NetworkName, BoltzEndpointConfig>
> = {
  bitcoin: {
    primary: "https://api.boltz.exchange",
    legacy: ["https://api.ark.boltz.exchange"],
  },
  mutinynet: {
    primary: "https://api.boltz.mutinynet.arkade.sh",
    legacy: [],
  },
  signet: {
    primary: "https://boltz.signet.arkade.sh",
    legacy: [],
  },
  regtest: {
    primary: "http://localhost:9069",
    legacy: [],
  },
};

export function asBoltzNetwork(network: string): NetworkName | null {
  const n = network.toLowerCase() as NetworkName;
  return BOLTZ_ENDPOINTS[n] != null ? n : null;
}

export function boltzPrimaryApiUrlForNetwork(network: string): string | null {
  const n = asBoltzNetwork(network);
  return n ? (BOLTZ_ENDPOINTS[n]?.primary ?? null) : null;
}

export function boltzLegacyApiUrlsForNetwork(network: string): string[] {
  const n = asBoltzNetwork(network);
  return n ? [...(BOLTZ_ENDPOINTS[n]?.legacy ?? [])] : [];
}

export function boltzApiUrlsForNetwork(network: string): string[] {
  const primary = boltzPrimaryApiUrlForNetwork(network);
  if (!primary) return [];
  return [primary, ...boltzLegacyApiUrlsForNetwork(network)];
}

export function boltzApiUrlForNetwork(network: string): string | null {
  return boltzPrimaryApiUrlForNetwork(network);
}

export function isLightningSupportedForNetwork(
  network: string | null | undefined,
): boolean {
  if (!network) return false;
  return asBoltzNetwork(network) != null;
}

export function createRawBoltzSwapProvider(args: {
  network: NetworkName;
  apiUrl?: string;
}): BoltzSwapProvider {
  return new BoltzSwapProvider(args);
}

/**
 * Trixie-owned provider facade that routes swap-id methods through the
 * endpoint resolver. This allows historical legacy-only swaps to be
 * refreshed and recovered even when the SDK is configured with the
 * primary endpoint.
 */
export class TrixieBoltzSwapProvider extends BoltzSwapProvider {
  private readonly networkName: NetworkName;

  constructor(args: { network: NetworkName; apiUrl?: string }) {
    super(args);
    this.networkName = args.network;
  }

  private async withResolvedEndpoint<T>(
    swapId: string,
    operation: (provider: BoltzSwapProvider) => Promise<T>,
    fallbackToSuper: () => Promise<T>,
  ): Promise<T> {
    const resolved = await resolveBoltzSwapEndpoint({
      network: this.networkName,
      swapId,
    });

    if ("kind" in resolved || this.getApiUrl() === resolved.apiUrl) {
      return fallbackToSuper();
    }

    const resolvedProvider = createRawBoltzSwapProvider({
      network: this.networkName,
      apiUrl: resolved.apiUrl,
    });
    return operation(resolvedProvider);
  }

  override async getSwapStatus(id: string): Promise<GetSwapStatusResponse> {
    const resolved = await resolveBoltzSwapEndpoint({
      network: this.networkName,
      swapId: id,
    });
    if ("kind" in resolved) {
      return super.getSwapStatus(id);
    }
    return resolved.response;
  }

  override async monitorSwap(
    id: string,
    update: MonitorSwapUpdate,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["monitorSwap"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.monitorSwap(id, update),
      () => super.monitorSwap(id, update),
    );
  }

  override async getReverseSwapTxId(
    id: string,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["getReverseSwapTxId"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.getReverseSwapTxId(id),
      () => super.getReverseSwapTxId(id),
    );
  }

  override async getSwapPreimage(
    id: string,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["getSwapPreimage"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.getSwapPreimage(id),
      () => super.getSwapPreimage(id),
    );
  }

  override async refundSubmarineSwap(
    id: string,
    transaction: SubmarineRefundTransaction,
    checkpoint: SubmarineRefundCheckpoint,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["refundSubmarineSwap"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.refundSubmarineSwap(id, transaction, checkpoint),
      () => super.refundSubmarineSwap(id, transaction, checkpoint),
    );
  }

  override async refundChainSwap(
    id: string,
    transaction: ChainRefundTransaction,
    checkpoint: ChainRefundCheckpoint,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["refundChainSwap"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.refundChainSwap(id, transaction, checkpoint),
      () => super.refundChainSwap(id, transaction, checkpoint),
    );
  }

  override async getChainClaimDetails(
    id: string,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["getChainClaimDetails"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.getChainClaimDetails(id),
      () => super.getChainClaimDetails(id),
    );
  }

  override async getChainQuote(
    id: string,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["getChainQuote"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.getChainQuote(id),
      () => super.getChainQuote(id),
    );
  }

  override async postChainQuote(
    id: string,
    request: ChainQuoteRequest,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["postChainQuote"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.postChainQuote(id, request),
      () => super.postChainQuote(id, request),
    );
  }

  override async postChainClaimDetails(
    id: string,
    request: ChainClaimDetailsRequest,
  ): Promise<Awaited<ReturnType<BoltzSwapProvider["postChainClaimDetails"]>>> {
    return this.withResolvedEndpoint(
      id,
      (p) => p.postChainClaimDetails(id, request),
      () => super.postChainClaimDetails(id, request),
    );
  }
}

export function createTrixieBoltzSwapProvider(args: {
  network: NetworkName;
  apiUrl?: string;
}): TrixieBoltzSwapProvider {
  return new TrixieBoltzSwapProvider(args);
}

export function createBoltzSwapProvider(args: {
  network: NetworkName;
  apiUrl?: string;
}): BoltzSwapProvider {
  return createTrixieBoltzSwapProvider(args);
}

function readNestedString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : null;
}

export function isSwapNotFoundError(error: unknown): boolean {
  if (error instanceof SwapNotFoundError) return true;
  if (
    error &&
    typeof error === "object" &&
    (error as { name?: string }).name === "SwapNotFoundError"
  )
    return true;
  const needle = "could not find swap";
  const errorData =
    error && typeof error === "object"
      ? (error as { errorData?: unknown }).errorData
      : null;
  const apiMessage = readNestedString(errorData, "error");
  if (apiMessage?.toLowerCase().includes(needle)) return true;
  const message =
    error && typeof error === "object"
      ? (error as { message?: unknown }).message
      : null;
  if (typeof message === "string" && message.toLowerCase().includes(needle))
    return true;
  return false;
}

export async function resolveBoltzSwapEndpoint(args: {
  network: string;
  swapId: string;
}): Promise<ResolvedBoltzSwapEndpoint | BoltzSwapEndpointNotFound> {
  const network = asBoltzNetwork(args.network);
  if (!network) {
    throw new Error(`Boltz is not configured for ${args.network}`);
  }

  const config = BOLTZ_ENDPOINTS[network];
  if (!config) {
    throw new Error(`Boltz is not configured for ${args.network}`);
  }

  const checkedUrls: string[] = [];
  for (const [index, apiUrl] of [config.primary, ...config.legacy].entries()) {
    checkedUrls.push(apiUrl);
    const provider = createRawBoltzSwapProvider({ network, apiUrl });
    try {
      const response = await provider.getSwapStatus(args.swapId);
      return {
        apiUrl,
        source: index === 0 ? "primary" : "legacy",
        status: response.status,
        response,
      };
    } catch (e) {
      if (!isSwapNotFoundError(e)) throw e;
    }
  }

  return {
    kind: "not_found",
    swapId: args.swapId,
    checkedUrls,
  };
}
