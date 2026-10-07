// server/vitest.config.ts — each test boots PGlite (~220 MB WASM) and real wallets; under a full parallel run a single
// test can take several seconds (tens on a loaded many-core machine), so the 5 s default flakes. One worker per core on
// a 32-core machine runs out of memory and the workers die (ERR_IPC_CHANNEL_CLOSED), so cap them.
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { testTimeout: 60_000, maxWorkers: 6 } });
