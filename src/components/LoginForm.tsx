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
    <div className="login-screen page-enter">
      <div className="login-inner">
        <p className="login-brand">
          TorBox<span className="text-accent">DL</span>
        </p>
        <p className="login-tagline">
          Stream search to local library — unlock to continue.
        </p>

        <form onSubmit={onSubmit} className="login-form">
          <label>
            <span className="login-label">Password</span>
            <input
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          {error && (
            <p className="text-danger" style={{ margin: 0, fontSize: "0.875rem" }}>
              {error}
            </p>
          )}
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
