"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/", label: "Search" },
  { href: "/library", label: "Library" },
  { href: "/downloads", label: "Downloads" },
  { href: "/settings", label: "Settings" },
];

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname.startsWith("/login")) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="site-header">
      <div className="shell site-header-inner">
        <Link href="/" className="site-brand">
          <span>TorBox</span>
          <span className="site-brand-accent">DL</span>
        </Link>
        <nav className="site-nav">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={active ? "is-active" : ""}
              >
                {link.label}
              </Link>
            );
          })}
          <button type="button" onClick={() => void logout()}>
            Logout
          </button>
        </nav>
      </div>
    </header>
  );
}
