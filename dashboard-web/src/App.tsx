import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { KeyGate } from "./components/KeyGate";
import { useDashboardKey } from "./useDashboardKey";
import { Home } from "./components/Home";
import { Recorder } from "./components/Recorder";
import { fetchEncounters, fetchThreads } from "./api";
import type { Encounter, Thread } from "./types";

type View = "home" | "recorder";

function App() {
  const [dashboardKey, setDashboardKey] = useDashboardKey();
  const [view, setView] = useState<View>("home");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [t, e] = await Promise.all([fetchThreads(), fetchEncounters()]);
      setThreads(t.threads);
      setEncounters(e.encounters);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dashboardKey) void reload();
  }, [dashboardKey, reload]);

  if (!dashboardKey) {
    return <KeyGate onSubmit={setDashboardKey} />;
  }

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
          <Home threads={threads} encounters={encounters} onRefresh={reload} />
        ) : (
          <Recorder onRecorded={reload} />
        )}
      </main>
    </div>
  );
}

export default App;
