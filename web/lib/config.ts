// Plugin install sources (WS5): the Claude Code marketplace is this repo; the MCP server is the bundled plugin build.
export const PLUGIN_REPO = 'ixgnoy/PrefPool';
/** Solana cluster for explorer links; the live value also comes from GET /api/config/public (`cluster`). */
export const CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'devnet';
export const EXPLORER = 'https://explorer.solana.com';
const clusterQuery = (cluster: string) => (cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`);
export const explorerTx = (sig: string, cluster = CLUSTER) => `${EXPLORER}/tx/${sig}${clusterQuery(cluster)}`;
export const explorerAddress = (a: string, cluster = CLUSTER) => `${EXPLORER}/address/${a}${clusterQuery(cluster)}`;
export const FAUCET_URL = 'https://faucet.solana.com';
export const PHANTOM_URL = 'https://phantom.com/download';
export const SOLFLARE_URL = 'https://solflare.com';
export const BACKPACK_URL = 'https://backpack.app';
/** Shown until /api/config/public answers; the server's PLATFORM_FEE_USDC wins. */
export const DEFAULT_PLATFORM_FEE_USDC = 3;
export const DEMO_NOTE = 'Demo network: 29 synthetic owner profiles + 1 live wallet respondent.';
export const PRIVACY_NOTE = 'Companies never see your individual answers. They only see totals for groups of 15+.';
