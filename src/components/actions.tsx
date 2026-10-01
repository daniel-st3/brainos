"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Command } from "@/domain/commands";
export function CommandForm({
  storyId,
  version,
  command,
  children,
  label,
  variant = "",
  arrays = [],
}: {
  storyId: string;
  version: number;
  command: { type: Command["type"]; [key: string]: unknown };
  children?: ReactNode;
  label: string;
  variant?: string;
  arrays?: string[];
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const busy = pending || refreshing;
  return (
    <form
      className={`command-form ${variant}`}
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        setSuccess(false);
        try {
          const data = new FormData(event.currentTarget),
            payload: Record<string, unknown> = { ...command };
          for (const [key, value] of data.entries()) payload[key] = value;
          for (const key of arrays) payload[key] = data.getAll(key);
          if (command.type === "research" || command.type === "approve")
            payload.confirmed = data.get("confirmed") === "on";
          if (
            command.type === "schedule" &&
            typeof payload.scheduledAt === "string"
          )
            payload.scheduledAt = new Date(
              `${payload.scheduledAt}:00-05:00`,
            ).toISOString();
          const response = await fetch("/api/commands", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storyId,
              expectedVersion: version,
              command: payload,
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error);
          setSuccess(true);
          startRefresh(() => router.refresh());
        } catch (e) {
          setError(e instanceof Error ? e.message : "Unable to save.");
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      <button
        className={`button ${variant === "danger" ? "danger" : variant === "quiet" ? "secondary" : ""}`}
        disabled={busy}
        type="submit"
      >
        {busy ? "Saving…" : label}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="form-success" role="status">
          Saved.
        </p>
      )}
    </form>
  );
}
