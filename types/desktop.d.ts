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
  onCommand(callback: (command: string) => void): () => void;
}

interface Window {
  knouxDesktop?: KnouxDesktopBridge;
}