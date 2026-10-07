// shared/src/categories.ts: the platform's closed category list. Everything that gates on a category (owner policy,
// screening, owner facts, approval) reads it from here, so a campaign can never invent a category a model has to interpret.

/** What an agent can check about its own work. Allowed by the default owner policy. */
export const AGENT_CATEGORIES = ['agent_setup', 'tools_mcp', 'payments', 'integrations', 'workflows', 'blockers', 'developer_tools'];
/** About the owner rather than the agent: opt-in in the owner policy, and "sensitive" for `approve_sensitive`. */
export const OWNER_FACING_CATEGORIES = ['spending', 'personal_life'];
/** Never askable: personal-sensitive topics, and `credentials` (keys, passwords, how an agent stores secrets). */
export const SENSITIVE_CATEGORIES = ['health', 'religion', 'ethnicity', 'politics', 'sexual_orientation', 'credentials'];
export const KNOWN_CATEGORIES = [...AGENT_CATEGORIES, ...OWNER_FACING_CATEGORIES, ...SENSITIVE_CATEGORIES];
