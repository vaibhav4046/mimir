/**
 * Reads MIMIR_<name>, falling back to the legacy GROKBOT_<name> so existing launch scripts,
 * scheduled tasks and installs keep working after the rename.
 */
export function envVar(name) {
  return process.env[`MIMIR_${name}`] ?? process.env[`GROKBOT_${name}`];
}
