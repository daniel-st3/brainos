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
  X,
  Settings2,
  Radar,
  Layers,
  ArrowUpRight,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { DvniMark } from "./design/primitives";
const groups = [
  {
    title: "Editorial",
    links: [
      ["/", "Command Center", LayoutDashboard],
      ["/brief", "Morning brief", Newspaper],
      ["/inbox", "Story Inbox", Inbox],
      ["/review", "Review", ClipboardCheck],
    ],
  },
  {
    title: "Creation",
    links: [
      ["/actions", "My Actions", ClipboardCheck],
      ["/production", "Production", Clapperboard],
      ["/production/studio", "Production Studio", Layers],
      ["/workbench", "Content Workbench", LayoutDashboard],
      ["/publish", "Publish", Send],
    ],
  },
  {
    title: "Workspace",
    links: [
      ["/activation", "Account Activation", Settings2],
      ["/operations-center", "Operations", Radar],
      ["/opportunities", "Opportunities", Inbox],
    ],
  },
] as const;
const publicRoutes = [
  "/about",
  "/content",
  "/contact",
  "/privacy",
  "/terms",
  "/data-deletion",
  "/offline",
  "/recording-demo",
];
export function Shell({
  children,
  demo,
}: {
  children: ReactNode;
  demo: boolean;
}) {
  const pathname = usePathname(),
    drawer = useRef<HTMLDialogElement>(null),
    [open, setOpen] = useState(false);
  const close = () => {
    drawer.current?.close();
    setOpen(false);
  };
  if (pathname.startsWith("/review-link/"))
    return (
      <main
        id="main-content"
        className="page"
        style={{ maxWidth: 820, margin: "auto", padding: 24 }}
      >
        {children}
      </main>
    );
  if (pathname === "/login")
    return (
      <main id="main-content" tabIndex={-1} className="auth-shell">
        <Link href="/about" className="auth-brand">
          <DvniMark />
          <span>Daniel Rodriguez / BrainOS</span>
        </Link>
        {children}
        <p className="auth-footnote">
          A private workspace. A human at every release.
        </p>
      </main>
    );
  if (publicRoutes.includes(pathname) || pathname.startsWith("/builds/"))
    return (
      <div className="public-frame" lang="es">
        <header className="public-nav">
          <Link href="/about" aria-label="DVNI home">
            <DvniMark />
          </Link>
          <span className="public-creator">Daniel Rodriguez</span>
          <nav aria-label="Public navigation">
            <Link href="/content">Contenido</Link>
            <Link href="/about#newsletter">Newsletter</Link>
            <Link href="/contact">
              Contacto <ArrowUpRight size={14} />
            </Link>
          </nav>
        </header>
        <main id="main-content" tabIndex={-1} className="public-main">
          {children}
        </main>
        <footer className="public-footer">
          <DvniMark />
          <span>Applied AI. Built, tested, explained.</span>
          <nav aria-label="Legal">
            <Link href="/privacy">Privacidad</Link>
            <Link href="/terms">Condiciones</Link>
          </nav>
        </footer>
      </div>
    );
  const selected = groups
    .flatMap((g) => [...g.links])
    .find(([href]) => pathname === href);
  const navigation = (mobile = false) => (
    <>
      <Link href="/" className="brand" onClick={close}>
        <DvniMark />
        <span>
          BrainOS<small>CONTENT WORKSPACE</small>
        </span>
      </Link>
      <nav aria-label={mobile ? "Mobile navigation" : "Main navigation"}>
        {groups.map((group) => (
          <div className="nav-group" key={group.title}>
            <div className="nav-label">{group.title}</div>
            {group.links.map(([href, label, Icon]) => {
              const active =
                pathname === href ||
                (href === "/inbox" && pathname.startsWith("/stories/"));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${active ? "active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={close}
                >
                  <Icon size={17} strokeWidth={1.6} />
                  {label}
                  {active && <ChevronRight size={13} className="nav-chevron" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-note">
        <span className="small-cap">THE EDITORIAL STANDARD</span>
        <p>
          Evidence first.
          <br />
          Your point of view.
        </p>
        <span className="rule-line" />
      </div>
      <div className="profile">
        <span className="avatar">DR</span>
        <div>
          Daniel Rodriguez<small>Editor & creator</small>
        </div>
      </div>
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">{navigation()}</aside>
      <dialog
        ref={drawer}
        className="nav-drawer"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'a[href],button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]',
            ),
          ).filter((e) => e.getBoundingClientRect().height > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        aria-label="Workspace navigation"
      >
        <div className="drawer-sidebar">
          <button
            className="icon-button drawer-close"
            aria-label="Close navigation"
            onClick={close}
          >
            <X size={20} />
          </button>
          {navigation(true)}
        </div>
      </dialog>
      <div className="app-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Toggle navigation"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => {
              drawer.current?.showModal();
              setOpen(true);
            }}
          >
            <PanelLeft size={20} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>
            <strong>
              {selected?.[1] ??
                (pathname.startsWith("/stories/")
                  ? "Story Workspace"
                  : "Newsroom")}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="edition">ES · BOGOTÁ</span>
            <span className={`mode-badge ${demo ? "" : "live"}`}>
              {demo ? "DEMO WORKSPACE" : "LIVE WORKSPACE"}
            </span>
          </div>
        </header>
        <div className="demo-strip">
          {demo
            ? "Fictional editorial scenarios. Changes persist locally. No live news, measured results, or external publishing."
            : "Evidence reviewed. Revisions bound. Every release requires human approval."}
        </div>
        <main id="main-content" tabIndex={-1} className="workspace-main">
          <div className="page-enter" key={pathname}>
            {children}
          </div>
        </main>
        <footer className="footer">
          <span>BRAINOS / DANIEL RODRIGUEZ</span>
          <span>Human judgment, at every release.</span>
        </footer>
        <nav className="mobile-dock" aria-label="Quick actions">
          <Link
            href="/actions"
            aria-current={pathname === "/actions" ? "page" : undefined}
          >
            <ClipboardCheck size={19} />
            My Actions
          </Link>
          <Link
            href="/brief"
            aria-current={pathname === "/brief" ? "page" : undefined}
          >
            <Newspaper size={19} />
            Brief
          </Link>
          <Link
            href="/production/studio"
            aria-current={
              pathname === "/production/studio" ? "page" : undefined
            }
          >
            <Clapperboard size={19} />
            Studio
          </Link>
        </nav>
      </div>
    </div>
  );
}
