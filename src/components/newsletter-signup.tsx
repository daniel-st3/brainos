"use client";
import { useState } from "react";
export function NewsletterSignup() {
  const [message, setMessage] = useState(""),
    [token, setToken] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget),
          r = await fetch("/api/public/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: form.get("email"),
              consent: form.get("consent") === "on",
              website: form.get("website"),
            }),
          });
        const data = await r.json();
        setMessage(data.message ?? data.error);
        setToken(data.unsubscribe_token ?? "");
      }}
    >
      <label>
        Email
        <input name="email" type="email" required maxLength={254} />
      </label>
      <label className="signup-honeypot" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>
      <label className="consent">
        <input name="consent" type="checkbox" required />
        Acepto que Daniel guarde mi email para su newsletter. Puedo retirar el
        consentimiento. No se envían emails todavía.
      </label>
      <button className="button dark">Guardar mi interés</button>
      <p role="status">{message}</p>
      {token && (
        <button
          type="button"
          className="button"
          onClick={async () => {
            await fetch("/api/public/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            setMessage("Consentimiento retirado.");
            setToken("");
          }}
        >
          Retirar consentimiento
        </button>
      )}
    </form>
  );
}
