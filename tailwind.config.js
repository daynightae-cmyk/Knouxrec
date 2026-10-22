/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./*.{ts,tsx}",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
    "./elysian-canvas/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Design System Colors
        "bg-primary": "#0A0A0B",
        "bg-secondary": "#1D1D1F",
        "bg-tertiary": "#242424",
        "accent-primary": "#FFDE00",
        "accent-secondary": "#FFE033",
        "surface-overlay": "rgba(29, 29, 31, 0.6)",
        "surface-hover": "rgba(255, 255, 255, 0.05)",
        "surface-active": "rgba(255, 255, 255, 0.1)",
        "border-primary": "rgba(255, 255, 255, 0.1)",
        "border-secondary": "rgba(255, 255, 255, 0.2)",
        "text-primary": "rgba(255, 255, 255, 1)",
        "text-secondary": "rgba(255, 255, 255, 0.8)",
        "text-tertiary": "rgba(255, 255, 255, 0.7)",
        "text-muted": "rgba(255, 255, 255, 0.6)",

        // Status Colors
        "status-success": "#10b981",
        "status-error": "#ef4444",
        "status-warning": "#f59e0b",
        "status-info": "#3b82f6",

        // Legacy KNOUX colors for compatibility
        "knoux-purple": "#8b5cf6",
        "knoux-neon": "#00d9ff",
        "knoux-neon-blue": "#00d9ff",
        "knoux-dark": "#0f0f23",
        "knoux-dark-glass": "rgba(15, 15, 35, 0.7)",
        "knoux-light": "#1a1a2e",
      },

      fontFamily: {
        rajdhani: ["Rajdhani", "sans-serif"],
        inter: ["Inter", "sans-serif"],
        orbitron: ["Orbitron", "monospace"], // Keep for compatibility
      },

      backgroundImage: {
        "gradient-accent": "linear-gradient(45deg, #FFDE00, #FFE033)",
        "gradient-recording": "linear-gradient(45deg, #FF4444, #FF6666)",
        "gradient-surface":
          "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
      },

      backdropBlur: {
        20: "20px",
        25: "25px",
      },

      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "scale-in": "scaleIn 0.2s ease-out",
      },

      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        scaleIn: {
          "0%": { transform: "scale(0.95)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
      },

      spacing: {
        18: "4.5rem",
        88: "22rem",
      },

      borderRadius: {
        "4xl": "2rem",
      },

      boxShadow: {
        "glow-yellow": "0 0 20px rgba(255, 222, 0, 0.3)",
        "glow-red": "0 0 20px rgba(255, 68, 68, 0.3)",
        "card-hover": "0 20px 40px rgba(255, 222, 0, 0.1)",
      },

      zIndex: {
        60: "60",
        70: "70",
        80: "80",
        90: "90",
        100: "100",
      },
    },
  },
  plugins: [
    function ({ addUtilities, addComponents }) {
      const newUtilities = {
        ".backdrop-blur-20": {
          "backdrop-filter": "blur(20px)",
          "-webkit-backdrop-filter": "blur(20px)",
        },
        ".backdrop-blur-25": {
          "backdrop-filter": "blur(25px)",
          "-webkit-backdrop-filter": "blur(25px)",
        },
        ".glass-panel": {
          background: "rgba(29, 29, 31, 0.6)",
          "backdrop-filter": "blur(20px)",
          "-webkit-backdrop-filter": "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        },
        ".transition-smooth": {
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        },
        ".transition-fast": {
          transition: "all 0.15s ease",
        },
      };

      const newComponents = {
        ".btn-primary": {
          background: "linear-gradient(45deg, #FFDE00, #FFE033)",
          color: "#000",
          border: "2px solid #FFE033",
          "font-weight": "600",
          padding: "12px 24px",
          "border-radius": "12px",
          transition: "all 0.3s ease",
          cursor: "pointer",
          "&:hover": {
            transform: "scale(1.02)",
            "box-shadow": "0 0 20px rgba(255, 222, 0, 0.3)",
          },
          "&:active": {
            transform: "scale(0.95)",
          },
        },
        ".btn-secondary": {
          background: "rgba(255, 255, 255, 0.05)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          color: "white",
          padding: "8px 16px",
          "border-radius": "8px",
          transition: "all 0.2s ease",
          cursor: "pointer",
          "&:hover": {
            background: "rgba(255, 255, 255, 0.1)",
            "border-color": "rgba(255, 255, 255, 0.2)",
          },
        },
        ".card": {
          background: "rgba(29, 29, 31, 0.6)",
          "backdrop-filter": "blur(20px)",
          "-webkit-backdrop-filter": "blur(20px)",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          "border-radius": "16px",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          "&:hover": {
            transform: "translateY(-4px)",
            "box-shadow": "0 20px 40px rgba(255, 222, 0, 0.1)",
          },
        },
        ".nav-item": {
          display: "flex",
          "align-items": "center",
          gap: "12px",
          padding: "12px",
          "border-radius": "4px",
          transition: "all 0.2s ease",
          cursor: "pointer",
          "&:hover": {
            background: "rgba(255, 255, 255, 0.05)",
          },
          "&.active": {
            background: "#242424",
            "border-left": "6px solid #FFDE00",
          },
        },
      };

      addUtilities(newUtilities);
      addComponents(newComponents);
    },
  ],
  darkMode: "class",
};
