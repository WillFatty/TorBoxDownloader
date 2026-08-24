"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { readJson } from "./LibraryShared";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await readJson<{ error?: string; ok?: boolean }>(res);
      if (!res.ok) throw new Error(data.error || "Login failed");
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="page-enter"
      style={{
        position: "relative",
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        padding: "4rem 1.25rem",
      }}
    >
      <div
        className="ambient-orb"
        style={{
          left: "-6rem",
          top: "25%",
          width: "18rem",
          height: "18rem",
          background: "color-mix(in srgb, var(--accent) 20%, transparent)",
        }}
        aria-hidden
      />
      <div
        className="ambient-orb"
        style={{
          right: "-4rem",
          bottom: "25%",
          width: "16rem",
          height: "16rem",
          background: "color-mix(in srgb, var(--info) 15%, transparent)",
          animationDelay: "2s",
        }}
        aria-hidden
      />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "22rem", textAlign: "center" }}>
        <p className="display" style={{ margin: 0, fontSize: "clamp(2.5rem, 8vw, 3.5rem)", color: "var(--ink)" }}>
          TorBox<span className="text-accent">DL</span>
        </p>
        <p className="muted" style={{ margin: "1rem auto 0", maxWidth: "18rem", fontSize: "0.95rem" }}>
          Stream search to local library — unlock to continue.
        </p>

        <form onSubmit={onSubmit} style={{ marginTop: "2.5rem", display: "flex", flexDirection: "column", gap: "1rem", textAlign: "left" }}>
          <label style={{ display: "block" }}>
            <span
              className="muted"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontSize: "0.7rem",
                fontWeight: 650,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              Password
            </span>
            <input
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {error && <p className="text-danger" style={{ margin: 0, fontSize: "0.875rem" }}>{error}</p>}
          <button
            type="submit"
            className="btn-primary"
            style={{ width: "100%" }}
            disabled={loading || !password}
          >
            {loading ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}
