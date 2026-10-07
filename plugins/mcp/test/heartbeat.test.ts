// plugins/mcp/test/heartbeat.test.ts: while the agent app runs, the plugin checks in every minute (the website shows "Online").
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHeartbeat } from '../src/heartbeat.js';

afterEach(() => { vi.useRealTimers(); });

describe('startHeartbeat', () => {
  it('checks in right away, then every interval, and stops when told', async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => ({}));
    const stop = startHeartbeat(ping, 60_000);
    expect(ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(ping).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(ping).toHaveBeenCalledTimes(4);
  });
  it('keeps beating when the server is unreachable', async () => {
    vi.useFakeTimers();
    const ping = vi.fn(async () => { throw new Error('fetch failed'); });
    const stop = startHeartbeat(ping, 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(2);
    stop();
  });
});
