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
}

interface Window {
  knouxDesktop?: KnouxDesktopBridge;
}