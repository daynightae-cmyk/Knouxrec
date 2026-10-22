import React, { useState, useCallback } from "react";

interface SliderConfig {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  category: string;
  description?: string;
  curve?: "linear" | "exponential" | "logarithmic";
}

interface MasterSliderProps {
  configs: SliderConfig[];
  onValueChange: (id: string, value: number) => void;
  masterIntensity?: number;
  onMasterIntensityChange?: (value: number) => void;
  disabled?: boolean;
  preset?: string;
}

export const MasterSlider: React.FC<MasterSliderProps> = ({
  configs,
  onValueChange,
  masterIntensity = 1.0,
  onMasterIntensityChange,
  disabled = false,
  preset,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [hoveredSlider, setHoveredSlider] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const categories = Array.from(
    new Set(configs.map((config) => config.category)),
  );

  const filteredConfigs =
    activeCategory === "all"
      ? configs
      : configs.filter((config) => config.category === activeCategory);

  const applyCurve = useCallback(
    (value: number, curve: SliderConfig["curve"], min: number, max: number) => {
      const normalized = (value - min) / (max - min);
      let curved;

      switch (curve) {
        case "exponential":
          curved = Math.pow(normalized, 2);
          break;
        case "logarithmic":
          curved = Math.sqrt(normalized);
          break;
        default:
          curved = normalized;
      }

      return min + curved * (max - min);
    },
    [],
  );

  const handleSliderChange = useCallback(
    (config: SliderConfig, rawValue: number) => {
      if (disabled || isLocked) return;

      const curvedValue = applyCurve(
        rawValue,
        config.curve,
        config.min,
        config.max,
      );
      const adjustedValue = curvedValue * masterIntensity;

      onValueChange(config.id, adjustedValue);
    },
    [disabled, isLocked, masterIntensity, onValueChange, applyCurve],
  );

  const handleMasterChange = useCallback(
    (value: number) => {
      if (onMasterIntensityChange) {
        onMasterIntensityChange(value);
      }
    },
    [onMasterIntensityChange],
  );

  const resetToDefaults = useCallback(() => {
    filteredConfigs.forEach((config) => {
      onValueChange(config.id, config.value);
    });
  }, [filteredConfigs, onValueChange]);

  return (
    <div className="master-slider-container">
      {/* Master Control */}
      <div className="master-control-section">
        <div className="master-header">
          <h3 className="master-title">✨ Master Artistic Control</h3>
          <div className="master-actions">
            <button
              onClick={() => setIsLocked(!isLocked)}
              className={`lock-button ${isLocked ? "locked" : ""}`}
              title={isLocked ? "Unlock controls" : "Lock controls"}
            >
              {isLocked ? "🔒" : "🔓"}
            </button>
            <button onClick={resetToDefaults} className="reset-button">
              ↺ Reset
            </button>
          </div>
        </div>

        <div className="master-intensity-control">
          <label className="master-label">
            Overall Intensity
            <span className="master-value">
              {(masterIntensity * 100).toFixed(0)}%
            </span>
          </label>
          <div className="master-slider-wrapper">
            <input
              type="range"
              min="0"
              max="2"
              step="0.01"
              value={masterIntensity}
              onChange={(e) => handleMasterChange(parseFloat(e.target.value))}
              className="master-slider-input"
              disabled={disabled}
            />
            <div className="master-slider-track">
              <div
                className="master-slider-fill"
                style={{ width: `${Math.min(masterIntensity * 50, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Category Filter */}
      <div className="category-filter">
        <div className="category-tabs">
          <button
            onClick={() => setActiveCategory("all")}
            className={`category-tab ${activeCategory === "all" ? "active" : ""}`}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`category-tab ${activeCategory === category ? "active" : ""}`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Individual Controls */}
      <div className="controls-grid">
        {filteredConfigs.map((config) => (
          <div
            key={config.id}
            className={`control-item ${hoveredSlider === config.id ? "hovered" : ""}`}
            onMouseEnter={() => setHoveredSlider(config.id)}
            onMouseLeave={() => setHoveredSlider(null)}
          >
            <div className="control-header">
              <label className="control-label">{config.label}</label>
              <span className="control-value">
                {config.value.toFixed(2)}
                {config.unit || ""}
              </span>
            </div>

            {config.description && hoveredSlider === config.id && (
              <div className="control-description">{config.description}</div>
            )}

            <div className="slider-wrapper">
              <input
                type="range"
                min={config.min}
                max={config.max}
                step={config.step}
                value={config.value}
                onChange={(e) =>
                  handleSliderChange(config, parseFloat(e.target.value))
                }
                className="control-slider"
                disabled={disabled || isLocked}
              />
              <div className="slider-track">
                <div
                  className="slider-fill"
                  style={{
                    width: `${((config.value - config.min) / (config.max - config.min)) * 100}%`,
                    background:
                      config.category === "lighting"
                        ? "#ffd700"
                        : config.category === "color"
                          ? "#ff6b6b"
                          : config.category === "atmosphere"
                            ? "#4ecdc4"
                            : config.category === "material"
                              ? "#95a5a6"
                              : "#3498db",
                  }}
                />
                <div className="slider-markers">
                  {[0.25, 0.5, 0.75].map((position) => (
                    <div
                      key={position}
                      className="slider-marker"
                      style={{ left: `${position * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="range-labels">
              <span className="range-min">{config.min}</span>
              <span className="range-max">{config.max}</span>
            </div>
          </div>
        ))}
      </div>

      {preset && (
        <div className="preset-indicator">
          <span className="preset-label">Active Preset:</span>
          <span className="preset-name">{preset}</span>
        </div>
      )}

      <style>{`
        .master-slider-container {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 24px;
          backdrop-filter: blur(20px);
          max-height: 600px;
          overflow-y: auto;
        }

        .master-control-section {
          margin-bottom: 24px;
          padding-bottom: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .master-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .master-title {
          color: #ffd700;
          margin: 0;
          font-size: 1.2rem;
          font-weight: 600;
        }

        .master-actions {
          display: flex;
          gap: 8px;
        }

        .lock-button,
        .reset-button {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          color: white;
          padding: 6px 12px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.3s ease;
        }

        .lock-button.locked {
          background: rgba(255, 193, 7, 0.2);
          border-color: rgba(255, 193, 7, 0.4);
        }

        .lock-button:hover,
        .reset-button:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .master-intensity-control {
          position: relative;
        }

        .master-label {
          display: flex;
          justify-content: space-between;
          color: rgba(255, 255, 255, 0.9);
          font-weight: 500;
          margin-bottom: 12px;
        }

        .master-value {
          color: #ffd700;
          font-weight: 600;
        }

        .master-slider-wrapper {
          position: relative;
          height: 40px;
          display: flex;
          align-items: center;
        }

        .master-slider-input {
          width: 100%;
          height: 8px;
          background: transparent;
          outline: none;
          -webkit-appearance: none;
          position: relative;
          z-index: 2;
        }

        .master-slider-input::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #ffd700;
          cursor: pointer;
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
          border: 2px solid rgba(255, 255, 255, 0.3);
        }

        .master-slider-input::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #ffd700;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
        }

        .master-slider-track {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          transform: translateY(-50%);
          overflow: hidden;
        }

        .master-slider-fill {
          height: 100%;
          background: linear-gradient(90deg, #4ecdc4, #ffd700, #ff6b6b);
          transition: width 0.3s ease;
        }

        .category-filter {
          margin-bottom: 20px;
        }

        .category-tabs {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .category-tab {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.7);
          padding: 8px 16px;
          cursor: pointer;
          transition: all 0.3s ease;
          font-size: 0.9rem;
        }

        .category-tab.active {
          background: rgba(78, 205, 196, 0.2);
          border-color: rgba(78, 205, 196, 0.4);
          color: #4ecdc4;
        }

        .category-tab:hover {
          background: rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.9);
        }

        .controls-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
        }

        .control-item {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
          transition: all 0.3s ease;
        }

        .control-item.hovered {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.15);
          transform: translateY(-2px);
        }

        .control-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .control-label {
          color: rgba(255, 255, 255, 0.9);
          font-weight: 500;
          font-size: 0.95rem;
        }

        .control-value {
          color: #4ecdc4;
          font-weight: 600;
          font-family: monospace;
        }

        .control-description {
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.8rem;
          margin-bottom: 12px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 6px;
          border-left: 3px solid #4ecdc4;
        }

        .slider-wrapper {
          position: relative;
          margin: 12px 0;
        }

        .control-slider {
          width: 100%;
          height: 6px;
          background: transparent;
          outline: none;
          -webkit-appearance: none;
          position: relative;
          z-index: 2;
        }

        .control-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #4ecdc4;
          cursor: pointer;
          box-shadow: 0 0 8px rgba(78, 205, 196, 0.4);
          border: 2px solid rgba(255, 255, 255, 0.2);
        }

        .control-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #4ecdc4;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.2);
          box-shadow: 0 0 8px rgba(78, 205, 196, 0.4);
        }

        .control-slider:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .slider-track {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          transform: translateY(-50%);
          overflow: hidden;
        }

        .slider-fill {
          height: 100%;
          transition: width 0.3s ease;
          border-radius: 3px;
        }

        .slider-markers {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 100%;
        }

        .slider-marker {
          position: absolute;
          top: 0;
          width: 1px;
          height: 100%;
          background: rgba(255, 255, 255, 0.2);
          transform: translateX(-50%);
        }

        .range-labels {
          display: flex;
          justify-content: space-between;
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.8rem;
          font-family: monospace;
          margin-top: 4px;
        }

        .preset-indicator {
          margin-top: 20px;
          padding: 12px;
          background: rgba(255, 215, 0, 0.1);
          border: 1px solid rgba(255, 215, 0, 0.2);
          border-radius: 8px;
          text-align: center;
        }

        .preset-label {
          color: rgba(255, 255, 255, 0.7);
          margin-right: 8px;
        }

        .preset-name {
          color: #ffd700;
          font-weight: 600;
        }

        /* Scrollbar styling */
        .master-slider-container::-webkit-scrollbar {
          width: 6px;
        }

        .master-slider-container::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 3px;
        }

        .master-slider-container::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 3px;
        }

        .master-slider-container::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      `}</style>
    </div>
  );
};

export default MasterSlider;
