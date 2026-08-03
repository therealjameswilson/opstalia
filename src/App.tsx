import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchProject } from "./core/types";
import { createDemoProjects } from "./data/demo-projects";
import { listProjects, saveProject } from "./persistence/database";
import { AboutPage, PrivacyPage, SecurityPage } from "./pages/InfoPages";
import { ComparePage } from "./pages/ComparePage";
import { CoveragePage } from "./pages/CoveragePage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExemptionPage } from "./pages/ExemptionPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SavedPage } from "./pages/SavedPage";
import { SearchPage } from "./pages/SearchPage";

const PdfPacketPage = lazy(() => import("./pages/PdfPacketPage"));

type View =
  | "dashboard"
  | "new-search"
  | "projects"
  | "saved"
  | "compare"
  | "pdf-packets"
  | "coverage"
  | "exemptions"
  | "about"
  | "security"
  | "privacy";

const NAVIGATION: Array<{ id: View; label: string }> = [
  { id: "new-search", label: "New Search" },
  { id: "projects", label: "Search Projects" },
  { id: "saved", label: "Saved Records" },
  { id: "compare", label: "Compare Versions" },
  { id: "pdf-packets", label: "PDF Packet Lab" },
  { id: "coverage", label: "Source Coverage" },
  { id: "exemptions", label: "Exemption Guide" },
  { id: "about", label: "About" },
  { id: "security", label: "Security" }
];

const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  "new-search": "New Search",
  projects: "Search Projects",
  saved: "Saved Records",
  compare: "Compare Versions",
  "pdf-packets": "PDF Packet Lab",
  coverage: "Source Coverage",
  exemptions: "Exemption Guide",
  about: "About",
  security: "Security",
  privacy: "Privacy"
};

function initialView(): View {
  const hash = location.hash.replace(/^#/, "").split("?")[0];
  if (hash === "search") return "new-search";
  return ["dashboard", "new-search", "projects", "saved", "compare", "pdf-packets", "coverage", "exemptions", "about", "security", "privacy"].includes(hash)
    ? (hash as View)
    : "dashboard";
}

export default function App() {
  const builtInDemos = useMemo(createDemoProjects, []);
  const [view, setView] = useState<View>(initialView);
  const [projects, setProjects] = useState<SearchProject[]>(builtInDemos);
  const [currentProject, setCurrentProject] = useState<SearchProject | undefined>();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchSession, setSearchSession] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const hasMounted = useRef(false);

  const refreshProjects = useCallback(async () => {
    const stored = await listProjects();
    const merged = new Map<string, SearchProject>(builtInDemos.map((project) => [project.id, project]));
    for (const project of stored) merged.set(project.id, project);
    setProjects([...merged.values()]);
  }, [builtInDemos]);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const onHash = () => setView(initialView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = `${VIEW_TITLES[view]} | Opstalia`;
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [view]);

  const navigate = (next: string, clearProject = false) => {
    const nextView = next as View;
    if (clearProject) {
      setCurrentProject(undefined);
      setSearchSession((current) => current + 1);
    }
    setView(nextView);
    setMobileOpen(false);
    if (!location.hash.startsWith("#search?") || nextView !== "new-search") history.pushState(null, "", `#${nextView}`);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const updateProject = async (project: SearchProject) => {
    setCurrentProject(project);
    if (project.privateMode) return;
    setProjects((current) => [...current.filter((item) => item.id !== project.id), project]);
    await saveProject(project);
    await refreshProjects();
  };

  const openProject = (project: SearchProject) => {
    setCurrentProject(project);
    setSearchSession((current) => current + 1);
    navigate("new-search");
  };

  const openCompare = (recordIds: string[]) => {
    setCompareIds(recordIds);
    navigate("compare");
  };

  const workingProjects = currentProject?.privateMode
    ? [...projects.filter((project) => project.id !== currentProject.id), currentProject]
    : projects;

  const mainContent = (() => {
    switch (view) {
      case "new-search":
        return (
          <SearchPage
            key={`search-session-${searchSession}`}
            project={currentProject}
            onProjectUpdate={updateProject}
            onCompare={openCompare}
          />
        );
      case "projects":
        return (
          <ProjectsPage
            projects={projects}
            onProjectsChange={refreshProjects}
            onOpenProject={openProject}
            onLoadDemos={async () => {
              for (const demo of builtInDemos) await saveProject(demo);
              await refreshProjects();
            }}
          />
        );
      case "saved":
        return <SavedPage projects={workingProjects} onOpenProject={openProject} onCompare={openCompare} />;
      case "compare":
        return <ComparePage projects={workingProjects} initialRecordIds={compareIds} onProjectUpdate={updateProject} />;
      case "pdf-packets":
        return (
          <Suspense fallback={<p className="loading-state" role="status">Loading the PDF Packet Lab…</p>}>
            <PdfPacketPage />
          </Suspense>
        );
      case "coverage":
        return <CoveragePage />;
      case "exemptions":
        return <ExemptionPage />;
      case "about":
        return <AboutPage />;
      case "security":
        return <SecurityPage />;
      case "privacy":
        return <PrivacyPage />;
      default:
        return (
          <DashboardPage
            projects={projects}
            onNavigate={(next) => navigate(next, next === "new-search")}
            onOpenProject={openProject}
          />
        );
    }
  })();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="independent-banner">
        Opstalia is an independent research tool and is not an official U.S. Government website.
      </div>
      <header className="site-header">
        <button className="brand" onClick={() => navigate("dashboard")} aria-label="Opstalia dashboard">
          <span className="brand-mark" aria-hidden="true">O</span>
          <span><strong>OPSTALIA</strong><small>Declassified Records Search Engine</small></span>
          <b>1.0</b>
        </button>
        <button className="mobile-menu" onClick={() => setMobileOpen((value) => !value)} aria-expanded={mobileOpen} aria-controls="main-navigation">
          <span aria-hidden="true">☰</span> Menu
        </button>
        <nav id="main-navigation" className={mobileOpen ? "open" : ""} aria-label="Primary">
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id, item.id === "new-search")}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="classification-strip">
        <span>UNCLASSIFIED INTERNET APPLICATION</span>
        <span>NO OPSTALIA-C CONNECTION</span>
        <span>OFFICIAL PUBLIC SOURCES ONLY</span>
      </div>
      <main ref={mainRef} id="main-content" className="main-content" tabIndex={-1}>{mainContent}</main>
      <footer className="site-footer">
        <div>
          <span className="brand-mark" aria-hidden="true">O</span>
          <div>
            <strong>OPSTALIA 1.0</strong>
            <p>Search the official record of declassification.</p>
          </div>
        </div>
        <nav aria-label="Footer">
          <button onClick={() => navigate("about")}>About</button>
          <button onClick={() => navigate("privacy")}>Privacy</button>
          <button onClick={() => navigate("security")}>Security</button>
          <a href="https://github.com/therealjameswilson/opstalia" target="_blank" rel="noopener noreferrer">Source code ↗</a>
        </nav>
        <p className="footer-caveat">Use unclassified information only. Official source records and agency determinations control. MIT License.</p>
      </footer>
    </div>
  );
}
