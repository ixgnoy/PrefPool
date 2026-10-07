/** Plain-language meanings for the few protocol words the UI can't avoid (shown as hover/focus tooltips). */
export const GLOSSARY = {
  escrow: 'A Solana program account that holds the campaign budget. Only two things can move it: paying the accepted respondents, or refunding the company.',
  x402: 'A web payment standard: the server answers "402 Payment Required" with a price, your wallet pays, and the request goes through. No accounts or API keys.',
  CRE: 'Chainlink Runtime Environment: the separate workflow that decrypts answers, checks them and adds them up. Only totals leave it.',
  cohort: 'The group of accepted answers. Results are only shown when at least 15 people answered, so no one can be singled out.',
  devnet: "Solana's public developer network. Devnet SOL is free from the faucet and has no real value.",
} as const;
export type GlossaryTerm = keyof typeof GLOSSARY;
