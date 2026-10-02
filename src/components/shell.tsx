"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  ClipboardCheck,
  Clapperboard,
  Send,
  Newspaper,
  PanelLeft,
  ChevronRight,
} from "lucide-react";
import { useState, type ReactNode } from "react";
const nav = [
  ["/", "Command Center", LayoutDashboard],
  ["/inbox", "Story Inbox", Inbox],
  ["/review", "Review", ClipboardCheck],
  ["/production", "Production", Clapperboard],
  ["/publish", "Publish", Send],
  ["/actions", "My Actions", ClipboardCheck],
  ["/workbench", "Content Workbench", LayoutDashboard],
] as const;
export function Shell({
  children,
  demo,
}: {
  children: ReactNode;
  demo: boolean;
}) {
  const pathname = usePathname(),
    [open, setOpen] = useState(false);
  if (pathname === "/about") return <>{children}</>;
  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link href="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-mark">
            C<span>•</span>
          </span>
          <span>
            CONTENT OS<small>DANIEL RODRIGUEZ</small>
          </span>
        </Link>
        <div className="nav-label">NEWSROOM</div>
        <nav aria-label="Main navigation">
          {nav.map(([href, label, Icon]) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "nav-link active" : "nav-link"}
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              {label}
              {pathname === href && (
                <ChevronRight size={14} className="nav-chevron" />
              )}
            </Link>
          ))}
        </nav>
        <div className="nav-label second">DAILY EDITION</div>
        <Link
          className={`nav-link ${pathname === "/brief" ? "active" : ""}`}
          href="/brief"
          onClick={() => setOpen(false)}
        >
          <Newspaper size={18} />
          Morning brief
        </Link>
        <div className="sidebar-note">
          <span className="small-cap">THE EDITORIAL STANDARD</span>
          <p>
            Evidence first.
            <br />A point of view that’s yours.
          </p>
          <span className="rule-line" />
        </div>
        <div className="profile">
          <span className="avatar">DR</span>
          <div>
            Daniel Rodriguez<small>Editor & creator</small>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            onClick={() => setOpen(!open)}
          >
            <PanelLeft size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>Newsroom</strong>
          </div>
          <div className="topbar-right">
            <span className="edition">ES PRIMARY · BOGOTÁ</span>
            <span className={`mode-badge ${demo ? "" : "live"}`}>
              {demo ? "DEMO WORKSPACE" : "LIVE RESEARCH"}
            </span>
          </div>
        </header>
        {demo && (
          <div className="demo-strip">
            Fictional editorial scenarios. Changes persist locally. No live
            news, measured results, or external publishing.
          </div>
        )}
        {!demo && (
          <div className="demo-strip">
            Live source material · claims remain unverified until human review ·
            no external publishing.
          </div>
        )}
        <main id="main-content">{children}</main>
        <footer className="footer">
          <span>CONTENT OS / EDITORIAL WORKSPACE</span>
          <span>Human judgment, at every release.</span>
        </footer>
      </div>
    </div>
  );
}
