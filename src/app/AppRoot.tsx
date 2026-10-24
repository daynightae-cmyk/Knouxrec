import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CAPABILITIES, type RouteId } from "./capabilities";
import { translate } from "../i18n/translate";
import { useLibrary } from "../state/LibraryContext";
import { useRecorder } from "../state/RecorderContext";
import { useSettings } from "../state/SettingsContext";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ToastViewport from "./ToastViewport";
import SplashScreen, { type SplashStep } from "./SplashScreen";
import ErrorBoundary from "./ErrorBoundary";
import { SectionLoading } from "../views/ui";
import { inspectModels, MODEL_IDS } from "../services/modelRegistry";
import Dashboard from "../views/Dashboard";
import DiscoverView from "../views/DiscoverView";
import StudioView from "../views/StudioView";
import ScreenshotsView from "../views/ScreenshotsView";
import LibraryView from "../views/LibraryView";
import SettingsView from "../views/SettingsView";
import DiagnosticsView from "../views/DiagnosticsView";
import ModelsView from "../views/ModelsView";
import UnavailableView from "../views/UnavailableView";
import ToolboxView from "../views/ToolboxView";
import AiWorkspaceView from "../views/AiWorkspaceView";
import TemplatesView from "../views/TemplatesView";
import VisualPatchView from "../views/VisualPatchView";
import LiveStudioView from "../views/LiveStudioView";
import MorphCoreView from "../views/MorphCoreView";

const ElysianStudio = lazy(() => import("../views/ElysianStudioView"));

const ROUTE_IDS = Object.keys(CAPABILITIES) as RouteId[];
const SIDEBAR_KEY = "knoux-rec.sidebar.v1";

function parseRoute(): RouteId {
  if (typeof window === "undefined") return "dashboard";
  // A hash may carry a subpath (e.g. "#/live-studio/<jobId>"); the route is
  // always the first segment.
  const raw = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return (ROUTE_IDS as string[]).includes(raw) ? (raw as RouteId) : "dashboard";
}

function initialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export default function AppRoot() {
  const { settings } = useSettings();
  const { ready: libraryReady, error: libraryError } = useLibrary();
  const recorder = useRecorder();
  const t = (key: string) => translate(settings.language, key);

  const [route, setRoute] = useState<RouteId>(parseRoute);
  const [historyState, setHistoryState] = useState<{
    visits: RouteId[];
    index: number;
  }>(() => ({ visits: [parseRoute()], index: 0 }));
  const historyRef = useRef(historyState);
  historyRef.current = historyState;
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [fontsReady, setFontsReady] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [bootTimeout, setBootTimeout] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [modelsChecked, setModelsChecked] = useState(false);
  const [modelsPresent, setModelsPresent] = useState(0);
  const [holdSplash] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("intro") === "hold",
  );
  const mainRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onHash = () => {
      const next = parseRoute();
      setRoute(next);
      const current = historyRef.current;
      if (current.visits[current.index] === next) return;
      if (current.index > 0 && current.visits[current.index - 1] === next) {
        setHistoryState({ visits: current.visits, index: current.index - 1 });
        return;
      }
      if (
        current.index < current.visits.length - 1 &&
        current.visits[current.index + 1] === next
      ) {
        setHistoryState({ visits: current.visits, index: current.index + 1 });
        return;
      }
      const visits = [...current.visits.slice(0, current.index + 1), next];
      setHistoryState({ visits, index: visits.length - 1 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/dashboard");
    }
  }, []);

  const navigate = useCallback((next: RouteId, jobId?: string) => {
    const target = jobId ? `#/${next}/${jobId}` : `#/${next}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    } else {
      setRoute(next);
    }
  }, []);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  useEffect(() => {
    document.title = `${translate(
      settings.language,
      CAPABILITIES[route].labelKey,
    )} \u2014 KNOUX REC`;
  }, [route, settings.language]);

  useEffect(() => {
    let active = true;
    const deadline = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 3500),
    );
    void Promise.race([inspectModels(MODEL_IDS), deadline])
      .then((rows) => {
        if (!active) return;
        setModelsPresent(
          rows ? rows.filter((row) => row.weightsState === "present").length : 0,
        );
        setModelsChecked(true);
      })
      .catch(() => {
        if (active) setModelsChecked(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    document.fonts.ready
      .then(() => {
        if (active) setFontsReady(true);
      })
      .catch(() => {
        if (active) setFontsReady(true);
      });
    const timer = window.setTimeout(() => {
      if (active) setMinElapsed(true);
    }, 850);
    const failsafe = window.setTimeout(() => {
      if (active) setBootTimeout(true);
    }, 5000);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.clearTimeout(failsafe);
    };
  }, []);

  const settled = (fontsReady && (libraryReady || Boolean(libraryError))) || bootTimeout;

  useEffect(() => {
    if (!settled || !minElapsed || leaving || holdSplash) return;
    setLeaving(true);
  }, [settled, minElapsed, leaving, holdSplash]);

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setSplashDone(true), 430);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  useEffect(() => {
    const bridge = window.knouxDesktop;
    if (bridge) {
      const dispose = bridge.onCommand((command) => {
        if (command.startsWith("navigate:")) {
          const target = command.slice(9) as RouteId;
          if (ROUTE_IDS.includes(target)) navigate(target);
          return;
        }
        switch (command) {
          case "record.start":
            if (recorder.status === "idle") void recorder.start("screen");
            break;
          case "record.stop":
            if (recorder.status === "recording") void recorder.stop();
            break;
          case "record.toggle":
            if (recorder.status === "recording") void recorder.stop();
            else if (recorder.status === "paused") recorder.resume();
            else void recorder.start("screen");
            break;
          case "record.pause-toggle":
            if (recorder.status === "recording") recorder.pause();
            else if (recorder.status === "paused") recorder.resume();
            break;
          case "record.screenshot":
            void recorder.takeScreenshot();
            break;
        }
      });
      return dispose;
    }
  }, [navigate, recorder]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        void recorder.toggle("screen");
      } else if (key === "p") {
        event.preventDefault();
        if (recorder.status === "recording") recorder.pause();
        else if (recorder.status === "paused") recorder.resume();
      } else if (key === "s") {
        event.preventDefault();
        void recorder.takeScreenshot();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [recorder]);

  const steps: SplashStep[] = [
    {
      id: "capabilities",
      label: t("splash.checking"),
      state: recorder.support.display && recorder.support.mediaRecorder ? "done" : "warn",
    },
    {
      id: "fonts",
      label: t("splash.fonts"),
      state: fontsReady ? "done" : "active",
    },
    {
      id: "library",
      label: t("splash.library"),
      state: libraryReady ? "done" : libraryError ? "warn" : "active",
    },
    {
      id: "media",
      label: t("splash.media"),
      state: recorder.support.webcam ? "done" : "warn",
    },
    {
      id: "models",
      label: t("splash.models"),
      state: !modelsChecked ? "active" : modelsPresent > 0 ? "done" : "warn",
    },
  ];
  const completed = steps.filter((step) => step.state === "done" || step.state === "warn").length;
  const progress = Math.round((completed / steps.length) * 100);

  const toggleSidebar = () => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* storage can be blocked; collapse still works for this session */
      }
      return next;
    });
  };

  const renderRoute = () => {
    switch (route) {
      case "dashboard":
        return <Dashboard onNavigate={navigate} />;
      case "discover":
        return <DiscoverView onNavigate={navigate} />;
      case "studio":
        return <StudioView onNavigate={navigate} />;
      case "screenshots":
        return <ScreenshotsView />;
      case "library":
        return <LibraryView />;
      case "settings":
        return <SettingsView />;
      case "diagnostics":
        return <DiagnosticsView />;
      case "models":
        return <ModelsView />;
      case "templates":
        return <TemplatesView onNavigate={navigate} />;
      case "visual-patch":
        return <VisualPatchView />;
      case "morphcore":
        return <MorphCoreView />;
      case "body-editor":
        return <UnavailableView route={route} />;
      case "toolbox":
        return <ToolboxView onNavigate={navigate} />;
      case "offline-ai":
        return <AiWorkspaceView variant="offline-ai" />;
      case "arabic-ai":
        return <AiWorkspaceView variant="arabic-ai" />;
      case "elysian":
        return (
          <Suspense fallback={<SectionLoading label="Loading Elysian Canvas" />}>
            <ElysianStudio />
          </Suspense>
        );
      case "live-studio":
        return <LiveStudioView onNavigate={navigate} />;
      default:
        return <Dashboard onNavigate={navigate} />;
    }
  };

  return (
    <>
      {!splashDone && (
        <SplashScreen
          steps={steps}
          progress={progress}
          leaving={leaving}
          onSkip={() => setSplashDone(true)}
        />
      )}

      <div className="kx-app">
        <Sidebar
          route={route}
          onNavigate={navigate}
          collapsed={collapsed}
          onToggle={toggleSidebar}
        />
        <div className="kx-shell">
          <TopBar
            route={route}
            onNavigate={navigate}
            canBack={historyState.index > 0}
            canForward={historyState.index < historyState.visits.length - 1}
            onBack={() => {
              if (historyState.index > 0) window.history.back();
            }}
            onForward={() => {
              if (historyState.index < historyState.visits.length - 1) {
                window.history.forward();
              }
            }}
          />
          <div className="kx-main" ref={mainRef}>
            <ErrorBoundary resetKey={route}>
              {renderRoute()}
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <ToastViewport />
    </>
  );
}
