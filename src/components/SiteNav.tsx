
import { Link, useLocation, useNavigate } from "react-router-dom";

const links = [
  { href: "/", label: "Search" },
  { href: "/library", label: "Library" },
  { href: "/logs", label: "Logs" },
  { href: "/settings", label: "Settings" },
];

export function SiteNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathname = location.pathname;

  if (pathname.startsWith("/login")) return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    navigate("/login", { replace: true });
  }

  return (
    <header className="site-header">
      <div className="shell site-header-inner">
        <Link to="/" className="site-brand">
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
                to={link.href}
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
