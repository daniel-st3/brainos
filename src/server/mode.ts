/** Storage mode and data mode are independent: Supabase defaults to live, local defaults to demo. */
export function dataMode(): "demo" | "live" {
  const value =
    process.env.CONTENT_OS_DATA_MODE ??
    (process.env.CONTENT_OS_MODE === "supabase" ? "live" : "demo");
  if (value !== "demo" && value !== "live")
    throw new Error("CONTENT_OS_DATA_MODE must be demo or live.");
  return value;
}
