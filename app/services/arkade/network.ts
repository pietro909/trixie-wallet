export const DEFAULT_ARK_SERVER_URL = "https://mutinynet.arkade.sh";

const MAINNET_NETWORK_NAMES = new Set(["bitcoin", "mainnet"]);

export function isMainnetForNetworkName(network: string): boolean {
  return MAINNET_NETWORK_NAMES.has(network.toLowerCase());
}
