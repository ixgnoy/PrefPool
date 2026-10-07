// plugins/mcp/src/heartbeat.ts: while Claude Code / OpenClaw keeps this MCP server running, check in every minute so
// the owner's Agent page shows "Online" (any agent-token call updates last_seen). Failures are ignored: next beat retries.
export function startHeartbeat(ping: () => Promise<unknown>, intervalMs = 60_000): () => void {
  const beat = () => { ping().catch(() => {}); };
  beat();
  const timer = setInterval(beat, intervalMs);
  timer.unref?.(); // never keeps the process alive on its own
  return () => clearInterval(timer);
}
