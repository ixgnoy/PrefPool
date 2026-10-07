# PrefPool: Confidential Workflow (TEE) simulation proof

Chainlink CRE Confidential Workflow, run with the CRE CLI simulator (`cre workflow simulate`, target `confidential-settings`),
on a real PrefPool campaign funded and settled on Solana devnet.

| | |
|---|---|
| Campaign | `1a1141b8980f4976b9066a1265ddcfaa8115d37016b80741a6d8cd8b1fa6f114` ("State of agent payments & tools") |
| Date | 2026-10-07 (deadline 13:22:57 UTC, CRE run 13:23:13–13:23:26 UTC) |
| Handler | `handlerInTee` → `onAggregateInTee`, TEE: AWS Nitro, us-west-2 |
| Solana program (devnet) | `Cm1NmUPngoFke9pc8zXsK2qebBEfPb76bS3gHfjMS2hN` |
| Escrow account | `Bje9kbXPZM3eZwSNTUb9uJPeWMKGKNGBxDjLDv8AiC4c` |
| Funding tx | [`4z6RYFpA…AJSjDhLw`](https://explorer.solana.com/tx/4z6RYFpAfL9gwsgkxtJLpvVkDiUTbAFBAd9MTdUgUvDyr6eaTCSJWgu69muYieJiL7DtqUCP9ekcommkAJSjDhLw?cluster=devnet) |
| Settle tx | [`TWcE5SXe…ivtVuo`](https://explorer.solana.com/tx/TWcE5SXe79LKKFGpcHDsrDS8KXdYoqNXTdmPAsAeortGL7hr3ynruaBAJsXU7TH36otVy7uqy3bK5QCL4ivtVuo?cluster=devnet) (compute-budget → ed25519-verify → settle; 17 payees +0.01 SOL; fee 0.00001 SOL) |
| Report hash | `3f63ab17bf44ef9b8cbf1e7cc05a1c6a8ac26ae37ef6f21ba8ed779bcad8682f` |

## 1. The TEE handler (registered, and the core of the product)

`cre/aggregate/main.ts`:

- **Registration** (line 172): with `"confidential": true` in the target's config (`cre/aggregate/config.confidential.json`),
  the workflow registers `handlerInTee(new HTTPCapability().trigger({}), onAggregateInTee, [{ tee: 'nitro', regions: ['us-west-2'] }])`.
- **The handler** (`onAggregateInTee`, line 125) is not an example: it is the step that decides who gets paid. Its signed
  output is the only thing the Solana escrow program accepts for a payout (`solana/programs/campaign_escrow/src/instructions/settle.rs`
  checks the Ed25519 signature over the escrow, campaign id, report hash and payee list).

## 2. What is processed inside the enclave

| Sensitive input / value | Where |
|---|---|
| **Secret** `ENVELOPE_X25519_SK`: the private key every answer is encrypted to | `runtime.getSecret` in the TEE handler (line 129) |
| **Secret** `REPORT_ED25519_SK`: the key that authorizes payouts on Solana | line 130 |
| **Secret** `CRE_PLATFORM_TOKEN`: the platform API credential | line 131 |
| **22 sealed answers** (X25519 + XChaCha20-Poly1305 ciphertext), fetched from the platform and decrypted only here | `runPipeline` (line 156) |
| **Intermediate values**: plaintext answers, validation, duplicate removal, late filtering, the cohort-of-15 check, the per-question aggregates | `runPipeline` |
| **Private output** before it leaves: the signed settlement report (payee list) and the aggregate research report | posted from inside the handler to the platform |

Only aggregates (shares per option), counts and the signed payee list leave the enclave. No raw answer leaves it, and the
platform server only ever stores ciphertext.

## 3. Successful Confidential Workflow simulation (CRE CLI output)

```
Initializing...
Loading settings...
Checking RPC connectivity...
Compiling workflow...
✓ Workflow compiled
✓ Simulation limits enabled
  HTTP: req=120kb resp=250kb timeout=10s | ConfHTTP: req=125kb resp=500kb timeout=1m30s | Consensus obs=25kb | ChainWrite evm_report=50kb evm_gas=10000000 solana_report=265b solana_cu=300000 | WASM binary=100mb compressed=20mb
  Binary hash: 9f78ee62f76d772bf65ac3beaae1cd6fe3f0f3d98af33f1290254e5bdc028ee2
  Config hash: 6d72701e134e628fb240d62e4330b69f2bc4305af6c3da456d60fab52bfa2b83
✓ Parsed JSON input successfully
✓ Created HTTP trigger payload with 1 fields
2026-10-07T21:23:13Z [SIMULATION] Simulator Initialized

2026-10-07T21:23:13Z [SIMULATION] Running trigger trigger=http-trigger@1.0.0-alpha
╭────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Trigger requested TEE Execution your trigger will run in one of the following Tees:                │
│     - AWS Nitro in us-west-2                                                                       │
│ The simulator is not a real TEE, and is meant to debug.                                            │
│ Do not use it for sensitive information.                                                           │
│ During real execution, user logs for this trigger will not be visible, and will not leave the TEE. │
│ They are presented in the simulator for debugging only.                                            │
│                                                                                                    │
╰────────────────────────────────────────────────────────────────────────────────────────────────────╯

2026-10-07T21:23:22Z [USER LOG] [TEE] campaign 1a1141b8980f4976b9066a1265ddcfaa8115d37016b80741a6d8cd8b1fa6f114: accepted=17 rejected={"malformed":0,"duplicate":0,"ineligible":0,"late":5} reportHash=3f63ab17bf44ef9b8cbf1e7cc05a1c6a8ac26ae37ef6f21ba8ed779bcad8682f

✓ Workflow Simulation Result:
"{\"campaignId\":\"1a1141b8980f4976b9066a1265ddcfaa8115d37016b80741a6d8cd8b1fa6f114\",\"acceptedCount\":17,\"reportHash\":\"3f63ab17bf44ef9b8cbf1e7cc05a1c6a8ac26ae37ef6f21ba8ed779bcad8682f\",\"ack\":\"stored\",\"tee\":true}"

2026-10-07T21:23:26Z [SIMULATION] Execution finished signal received
2026-10-07T21:23:26Z [SIMULATION] Skipping WorkflowEngineV2

╭──────────────────────────────────────────────────────╮
│ Simulation complete! Ready to deploy your workflow?  │
│                                                      │
│ Run cre account access to request deployment access. │
╰──────────────────────────────────────────────────────╯
```

(The simulator prints timestamps in local time, UTC+8: 21:23 local = 13:23 UTC.)

## 4. Result: signed in the enclave, enforced on Solana

| | |
|---|---|
| Sealed answers received | 22 |
| Accepted | 17 (cohort minimum 15: met) |
| Not counted | 5 late (arrived after the deadline) |
| Escrowed | 0.2 SOL (20 × 0.01) |
| Paid to agents | 0.17 SOL to 17 addresses, in the settle tx above |
| Refunded to the buyer | 0.03 SOL, same transaction |
| CRE signature | verified off-chain by the platform and on-chain by the escrow program (ed25519-verify instruction) |

### Settlement report (signed inside the TEE)

```json
{
  "payouts": [
    { "address": "9h4dHENrBHAMGpXVFU3Zkx318woCSxyvQWUpdtQ8LfmB", "lamports": "10000000" },
    { "address": "2oH4o8c4e4pkU6dfrUi4vDjxVMbGUav7L3Q3MUpjLtKP", "lamports": "10000000" },
    { "address": "4VN8dMfiWe157TJ4dgHZPx7prd44GfWpMnNf7wYkqgSx", "lamports": "10000000" },
    { "address": "6qa5MtJsHyentX5noXu4jA24fqxNuh9wHYRDtwT68gi3", "lamports": "10000000" },
    { "address": "AAkRmkU7N74W25h49sMT9XJ734GohFAGeLNprBL7CJ21", "lamports": "10000000" },
    { "address": "FezAii3ky8VhkWHYBqgbrtyReb2MC2VYfR9xaoLTCrQm", "lamports": "10000000" },
    { "address": "7mhKnSZ2M2gigB6SHicumiiPSAULtcYyWQDPRoMSRtG6", "lamports": "10000000" },
    { "address": "2gHJ9hnNKPadP2EuditBpuwezMTdTPf6CeFHoaLuyV31", "lamports": "10000000" },
    { "address": "8cTKjrnogVHa2Ch7sBHheNALJdEL3kd8zpFWe6ALBgq7", "lamports": "10000000" },
    { "address": "4sJpJ8SqeMJHH6CVg3ypLnZv8r4GVp9Ef4w7BSPonTJE", "lamports": "10000000" },
    { "address": "C8pAyc4k9NbQjHrPLs3MkZP8GUyC4W48hGGcaSVSnZUF", "lamports": "10000000" },
    { "address": "4F9CsRbGgvUFtzWLfxf5yco1FPKeSSaPgxEBfLEev3yF", "lamports": "10000000" },
    { "address": "9zyUoPuLDa9NuiqMtF7e91QF7yNDRwodAiDq8jLeay9b", "lamports": "10000000" },
    { "address": "8m2WdJLuxnFA91yq9kAePnazzKhfaqq5DqM4apAnne83", "lamports": "10000000" },
    { "address": "5CkEoCJdxRzsuZSAQaioz5mgmauEgAzqjrq3eCMX5xJE", "lamports": "10000000" },
    { "address": "GMyP29gCEh8wWx6fBheu3JAsx5BR83GvDxeZQkCXyKpN", "lamports": "10000000" },
    { "address": "9hNFajL9xv7zQhY781qYVD1npn4SfznmooUQRTWhDVC", "lamports": "10000000" }
  ],
  "signature": "2e0a6a26256dc11ebc975168e6ae13536dd05c0e6af7ba7b0ad5097ad530a4ea56a7ac8e406800d0d444ecdd95caeeedcc18e2b77f4e54d496ff80ba8d93e000",
  "timestamp": "2026-10-07T13:23:22.682Z",
  "campaignId": "1a1141b8980f4976b9066a1265ddcfaa8115d37016b80741a6d8cd8b1fa6f114",
  "reportHash": "3f63ab17bf44ef9b8cbf1e7cc05a1c6a8ac26ae37ef6f21ba8ed779bcad8682f",
  "resultHash": "5cd4a711d1af7cb363cb36b92b5cdcd65fbcfbdbb401f9396f3a25a8838a089c",
  "escrowTxRef": "Bje9kbXPZM3eZwSNTUb9uJPeWMKGKNGBxDjLDv8AiC4c",
  "acceptedCount": 17,
  "refundAddress": "Azz9rxjSwepuUdDTMtb23zHbwNqcVqHghGUNHjrD8DKk",
  "schemaVersion": 1,
  "refundLamports": "30000000",
  "rejectionCounts": { "late": 5, "duplicate": 0, "malformed": 0, "ineligible": 0 },
  "settleSignature": "54cf9a07cdb530d91f3a046eba5198e809c2f73184c530807fc72708865ca4b69adfe72ec0fdeb02c50cec1cd82802f709ebbdc1a7fee4ea79b96f08a90cc70f",
  "escrowedLamports": "200000000",
  "payoutTotalLamports": "170000000",
  "rewardPerResponseLamports": "10000000"
}
```

### Aggregate research report (the only answer data that leaves the enclave)

```json
{
  "results": {
    "q1": { "Crypto wallet": 0.5294, "Card through a payment service": 0.4706, "Card and crypto wallet": 0, "None yet": 0 },
    "q2": { "1": 0, "2": 0.3529, "3": 0.2353, "4": 0.2353, "5": 0.1765 },
    "q3": { "Under $20": 0.2941, "$20-100": 0.1176, "Over $100": 0.1765, "Not sure": 0.4118 }
  },
  "clients": { "unknown": 17 },
  "sources": {
    "q1": { "checked": 0, "inferred": 0, "owner_told": 0, "unknown": 17 },
    "q2": { "checked": 0, "inferred": 0, "owner_told": 0, "unknown": 17 },
    "q3": { "checked": 0, "inferred": 0, "owner_told": 0, "unknown": 17 }
  },
  "minCohort": 15,
  "campaignId": "1a1141b8980f4976b9066a1265ddcfaa8115d37016b80741a6d8cd8b1fa6f114",
  "schemaVersion": 1,
  "validRespondents": 17,
  "verifiedHumans": 0,
  "simulatedHumans": 17,
  "calibratedAgents": 17
}
```

## 5. Reproduce

```bash
cd PrefPool && set -a && source .env && set +a
CRE_TARGET=confidential-settings npm start -w @as/cre-runner   # runs `cre workflow simulate aggregate --target confidential-settings` per campaign
```

Then create and fund a campaign in the web app (1-minute deadline); at the deadline the runner triggers the workflow, and
the platform relayer submits the CRE-signed settle transaction to Solana.
