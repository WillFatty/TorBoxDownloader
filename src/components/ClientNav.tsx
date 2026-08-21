"use client";

import { useEffect, useState } from "react";
import { SiteNav } from "@/components/SiteNav";

export function ClientNav() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return <div className="site-header" aria-hidden />;
  }

  return <SiteNav />;
}
