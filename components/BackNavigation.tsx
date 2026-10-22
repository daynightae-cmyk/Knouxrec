import React from "react";

interface BackNavigationProps {
  currentView:
    | "main"
    | "recordings"
    | "ai"
    | "settings"
    | "files"
    | "templates"
    | "toolbox"
    | "offline-tools"
    | "visual-patch-lab"
    | "ai-body-editor"
    | "knoux-morph-core"
    | "arabic-ai-tools"
    | "elysian"
    | "real-content";
  onBack: () => void;
  onNavigate: (
    view:
      | "main"
      | "recordings"
      | "ai"
      | "settings"
      | "files"
      | "templates"
      | "toolbox"
      | "offline-tools"
      | "visual-patch-lab"
      | "ai-body-editor"
      | "knoux-morph-core"
      | "arabic-ai-tools"
      | "elysian"
      | "real-content",
  ) => void;
}

const BackNavigation: React.FC<BackNavigationProps> = ({
  currentView,
  onBack,
  onNavigate,
}) => {
  const getViewTitle = (view: string) => {
    switch (view) {
      case "templates":
        return "📽️ Video Templates";
      case "toolbox":
        return "🛠️ AI Toolbox";
      case "recordings":
        return "🎬 Recording Library";
      case "ai":
        return "🧠 AI Analysis";
      case "files":
        return "📁 File Manager";
      case "settings":
        return "⚙️ Settings";
      case "offline-tools":
        return "🧠 أدوات أوفلاين";
      case "visual-patch-lab":
        return "🧩 Visual Patch Lab";
      case "ai-body-editor":
        return "🔞 AI Body Editor (18+)";
      case "knoux-morph-core":
        return "🧱 Knoux MorphCore™";
      case "arabic-ai-tools":
        return "🤖 أدوات الذكاء الاصطناعي العربية";
      case "elysian":
        return "🌌 Elysian Canvas";
      case "real-content":
        return "✨ Real Content Manager";
      default:
        return "🏠 KNOUX REC";
    }
  };

  const navigationItems = [
    { id: "main", icon: "🏠", label: "الرئيسية" },
    { id: "templates", icon: "📽️", label: "القوالب" },
    { id: "toolbox", icon: "🛠️", label: "Toolbox" },
    { id: "offline-tools", icon: "🧠", label: "أدوات أوفلاين" },
    { id: "arabic-ai-tools", icon: "🤖", label: "أدوات عربية" },
    { id: "visual-patch-lab", icon: "🧩", label: "Visual Patch" },
    { id: "knoux-morph-core", icon: "🧱", label: "MorphCore" },
    { id: "ai-body-editor", icon: "🔞", label: "AI Body Editor" },
    { id: "recordings", icon: "🎬", label: "Recordings" },
    { id: "ai", icon: "🧠", label: "AI Tools" },
    { id: "files", icon: "📁", label: "Files" },
    { id: "elysian", icon: "🌌", label: "Elysian" },
    { id: "real-content", icon: "✨", label: "Real Content" },
  ];

  return (
    <div className="glass-card mx-4 mt-4 mb-2 p-4 rounded-2xl">
      <div className="flex items-center justify-between">
        {/* Back Button & Current View */}
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="glow-button p-3 rounded-xl text-white hover:bg-knoux-purple/30 transition-all duration-300 group"
            title="Go Back"
          >
            <svg
              className="w-5 h-5 group-hover:transform group-hover:-translate-x-1 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>

          <div>
            <h1 className="text-xl font-orbitron font-bold text-white">
              {getViewTitle(currentView)}
            </h1>
            <div className="text-sm text-white/60">
              Navigate through KNOUX REC features
            </div>
          </div>
        </div>

        {/* Quick Navigation - Desktop */}
        <div className="hidden md:flex items-center space-x-2 overflow-x-auto pb-1">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id as any)}
              className={`flex-shrink-0 px-4 py-2 rounded-lg transition-all duration-300 flex items-center space-x-2 ${
                currentView === item.id
                  ? "bg-knoux-purple/30 border border-knoux-purple text-knoux-purple"
                  : "hover:bg-white/10 text-white/70 hover:text-white"
              }`}
              title={item.label}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="font-rajdhani font-medium">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Quick Navigation - Mobile (Icons only) */}
        <div className="md:hidden flex items-center space-x-2 overflow-x-auto pb-1">
          {navigationItems.map((item) => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id as any)}
              className={`flex-shrink-0 p-2 rounded-lg transition-all duration-300 ${
                currentView === item.id
                  ? "bg-knoux-purple/30 border border-knoux-purple text-knoux-purple"
                  : "hover:bg-white/10 text-white/70 hover:text-white"
              }`}
              title={item.label}
            >
              <span className="text-lg">{item.icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="mt-3 flex items-center space-x-2 text-sm text-white/50">
        <span>KNOUX REC</span>
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span className="text-knoux-purple">
          {getViewTitle(currentView).split(" ").slice(1).join(" ")}
        </span>
      </div>
    </div>
  );
};

export default BackNavigation;
