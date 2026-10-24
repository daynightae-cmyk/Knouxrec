
import AppRoot from "./src/app/AppRoot";
import { ToastProvider } from "./src/state/ToastContext";
import { SettingsProvider } from "./src/state/SettingsContext";
import { LibraryProvider } from "./src/state/LibraryContext";
import { HandoffProvider } from "./src/state/HandoffContext";
import { RecorderProvider } from "./src/state/RecorderContext";
import { JobsProvider } from "./src/state/JobsContext";
import { TooltipProvider } from "./src/ui/Tooltip";

/**
 * Thin application entry. The previous 149 KB inline prototype was corrupted
 * (binary replacement characters, broken JSX) and is preserved in git history
 * at commit 05a5429. All runtime behaviour now comes from the provider graph
 * below and the real capture/library services in src/.
 */
export default function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <LibraryProvider>
          <HandoffProvider>
            <JobsProvider>
              <RecorderProvider>
                <TooltipProvider>
                  <AppRoot />
                </TooltipProvider>
              </RecorderProvider>
            </JobsProvider>
          </HandoffProvider>
        </LibraryProvider>
      </SettingsProvider>
    </ToastProvider>
  );
}
