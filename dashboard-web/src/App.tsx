import { useCallback, useState } from "react";
import "./App.css";
// import { KeyGate } from "./components/KeyGate";
// import { useDashboardKey } from "./useDashboardKey";
import { Home } from "./components/Home";
import { Recorder } from "./components/Recorder";
import { fetchEncounters, fetchFlagged, fetchThreads } from "./api";
import type { Encounter, FlaggedThread, Thread } from "./types";

type View = "home" | "recorder";

function App() {
  // const [dashboardKey, setDashboardKey] = useDashboardKey();
  const [view, setView] = useState<View>("home");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [flagged, setFlagged] = useState<FlaggedThread[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    // Settled, not all-or-nothing: one endpoint failing (e.g. a route the
    // deployed Worker doesn't have yet) shouldn't blank out data the other
    // endpoints already have.
    const [t, e, f] = await Promise.allSettled([fetchThreads(), fetchEncounters(), fetchFlagged()]);
    const errors: string[] = [];

    if (t.status === "fulfilled") setThreads(t.value.threads);
    else errors.push(`threads: ${t.reason instanceof Error ? t.reason.message : String(t.reason)}`);

    if (e.status === "fulfilled") setEncounters(e.value.encounters);
    else errors.push(`encounters: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`);

    if (f.status === "fulfilled") setFlagged(f.value.flagged);
    else errors.push(`flagged: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);

    setLoadError(errors.join(" · "));
    setLoading(false);
  }, []);

  // useEffect(() => {
  //   if (dashboardKey) void reload();
  // }, [dashboardKey, reload]);

  // if (!dashboardKey) {
  //   return <KeyGate onSubmit={setDashboardKey} />;
  // }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Momentum Dashboard</h1>
        <nav>
          <button className={view === "home" ? "nav-tab active" : "nav-tab"} onClick={() => setView("home")}>
            Home
          </button>
          <button
            className={view === "recorder" ? "nav-tab active" : "nav-tab"}
            onClick={() => setView("recorder")}
          >
            Record
          </button>
        </nav>
      </header>

      <main>
        {loadError && <p className="error-text">{loadError}</p>}
        {loading && <p className="muted">Loading…</p>}
        {view === "home" ? (
          <Home threads={threads} encounters={encounters} flagged={flagged} onRefresh={reload} />
        ) : (
          <Recorder onRecorded={reload} />
        )}
      </main>
    </div>
  );
}

export default App;
