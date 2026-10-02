/** A central emergency stop overrides per-account, editor-granted authorization. */
export function externalWritesAllowed(account: Record<string, unknown>) {
  if (process.env.BRAINOS_EXTERNAL_PUBLISHING === "disabled") return false;
  if (process.env.BRAINOS_EXTERNAL_PUBLISHING === "enabled") return true;
  return (
    account.writes_authorized === true &&
    typeof account.writes_authorized_by === "string" &&
    !!account.writes_authorized_by &&
    typeof account.writes_authorized_at === "string" &&
    Number.isFinite(Date.parse(account.writes_authorized_at))
  );
}
