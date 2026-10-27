interface KnouxDesktopModelInfo {
  id: string;
  name: string;
  description: string;
  weightsPath: string;
  weightsState: "present" | "missing";
  weightsBytes: number;
}

interface KnouxDesktopBridge {
  isDesktop: true;
  platform: string;
  inspectModel(id: string): Promise<KnouxDesktopModelInfo | null>;
  /**
   * Ask the main process to hand a destination to the operating system. The
   * main process re-validates the scheme and resolves false when it refuses,
   * so a false here means "nothing opened" rather than a thrown error.
   */
  openExternal(url: string): Promise<boolean>;
  onCommand(callback: (command: string) => void): () => void;
  /**
   * Open a user-picked local model manifest (and optional weight file),
   * validate the manifest and weight integrity, and return a report. Remote
   * download is never offered by this bridge.
   */
  importModel(): Promise<{
    canceled?: boolean;
    ok?: boolean;
    reason?: string;
    manifest?: any;
    weights?: any;
    manifestSha256?: string;
  }>;
}

interface Window {
  knouxDesktop?: KnouxDesktopBridge;
}