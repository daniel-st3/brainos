import type { ComponentProps, ReactNode } from "react";
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "quiet" | "danger" | "inline";
}) {
  return <button className={`button ${variant} ${className}`} {...props} />;
}
export function Input(props: ComponentProps<"input">) {
  return <input {...props} />;
}
export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} />;
}
export function Select(props: ComponentProps<"select">) {
  return <select {...props} />;
}
export function Checkbox(props: Omit<ComponentProps<"input">, "type">) {
  return <input {...props} type="checkbox" />;
}
export function Toggle(props: Omit<ComponentProps<"input">, "type" | "role">) {
  return (
    <input
      {...props}
      type="checkbox"
      role="switch"
      className={`toggle ${props.className ?? ""}`}
    />
  );
}
export function StatusChip({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "negative";
  title?: string;
}) {
  return (
    <span className={`status-chip tone-${tone}`} title={title}>
      <span aria-hidden="true" className="status-dot" />
      {children}
    </span>
  );
}
export function FieldGroup({
  legend,
  children,
}: {
  legend: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="field-group">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}
export function InlineNotice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "warning" | "negative";
}) {
  return <div className={`notice tone-${tone}`}>{children}</div>;
}
export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="action-bar">{children}</div>;
}
export function DvniMark() {
  return (
    <span className="dvni-mark" aria-label="DVNI">
      D<span className="dvni-v">V</span>NI
      <span className="mark-signal" aria-hidden="true" />
    </span>
  );
}
