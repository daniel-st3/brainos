import type { Provider } from "../control/model";
import type { Payload } from "./client";
import { constraints } from "./definitions";
export function validatePayload(provider: Provider, p: Payload) {
  const rules = constraints(provider),
    issues: string[] = [];
  if (!p.title.trim() || p.title.length > rules.title)
    issues.push(`title: 1–${rules.title} characters`);
  if (!p.caption.trim() || p.caption.length > rules.caption)
    issues.push(`caption: 1–${rules.caption} characters`);
  if (provider === "x" && p.thread.some((t) => !t.trim() || t.length > 280))
    issues.push(
      "thread: every post must fit 280 UTF-16 characters (conservative)",
    );
  if (
    provider === "instagram" &&
    !p.media &&
    (!p.media_urls.length || p.media_urls.length > 10)
  )
    issues.push("Instagram: 1–10 approved JPEG images or one Reel required");
  if ((provider === "youtube" || provider === "tiktok") && !p.media)
    issues.push("validated video required");
  if (p.media) {
    const m = p.media;
    if (m.mime !== "video/mp4" || m.codec !== "h264")
      issues.push("H264 MP4 required by BrainOS delivery policy");
    if (
      !Number.isFinite(m.duration) ||
      m.duration <= 0 ||
      m.bytes <= 0 ||
      m.bytes > 50000000
    )
      issues.push("valid duration and <=50 MB delivery object required");
    if (
      m.width * 16 !== m.height * 9 &&
      ["instagram", "tiktok", "youtube"].includes(provider)
    )
      issues.push("vertical 9:16 required by this short-video package");
    if (provider === "youtube" && m.duration > 180)
      issues.push("Shorts must be <=180 seconds");
    if (provider === "instagram" && (m.duration < 3 || m.duration > 900))
      issues.push("Reel duration must be 3–900 seconds");
  }
  return { valid: !issues.length, issues, version: rules.version };
}
