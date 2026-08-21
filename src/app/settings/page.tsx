"use client";

import { useEffect, useState } from "react";
import { SettingsForm } from "@/components/SettingsForm";

export default function SettingsPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready) {
    return (
      <div className="page-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  return <SettingsForm />;
}
