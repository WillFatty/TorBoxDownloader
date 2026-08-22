"use client";

import { useEffect, useState } from "react";
import { LogsPage } from "@/components/LogsPage";

export default function Page() {
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
  return <LogsPage />;
}
