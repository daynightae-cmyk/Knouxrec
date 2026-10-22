import React, { useState, useEffect } from "react";

interface AdultGateAdvancedProps {
  onVerified: () => void;
  ephemeralId?: string;
}

export const AdultGateAdvanced: React.FC<AdultGateAdvancedProps> = ({
  onVerified,
  ephemeralId,
}) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [birthYear, setBirthYear] = useState("");
  const [confirmAge, setConfirmAge] = useState(false);
  const [artisticIntent, setArtisticIntent] = useState(false);
  const [ephemeralIdValue, setEphemeralIdValue] = useState<string | null>(
    ephemeralId ?? null,
  );

  const generateEphemeralId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2);
    return `elysian_${timestamp}_${random}`;
  };

  const handleVerification = () => {
    if (!birthYear || !confirmAge || !artisticIntent) return;

    const currentYear = new Date().getFullYear();
    const age = currentYear - parseInt(birthYear);

    if (age >= 18) {
      setIsVerifying(true);
      const newEphemeralId = ephemeralId || generateEphemeralId();
      // The confirmation is deliberately scoped to this session. A permanent
      // flag in localStorage was a one-line bypass for the age gate and is not
      // a real age check in any case: this is a self-declaration.
      try {
        sessionStorage.setItem("elysian_ephemeral_id", newEphemeralId);
        sessionStorage.setItem("elysian_verified", "true");
      } catch {
        // storage may be unavailable; the in-memory state still applies
      }
      setEphemeralIdValue(newEphemeralId);

      setTimeout(() => {
        setIsVerifying(false);
        onVerified();
      }, 1500);
    }
  };

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("elysian_verified");
      const storedId = sessionStorage.getItem("elysian_ephemeral_id");
      if (stored === "true" && storedId) {
        setEphemeralIdValue(storedId);
        onVerified();
      }
    } catch {
      // storage may be unavailable; the gate stays closed
    }
  }, [onVerified]);

  return (
    <div className="adult-gate-container">
      <div className="adult-gate-backdrop">
        <div className="adult-gate-content">
          <div className="gate-header">
            <h1 className="elysian-title">✨ Elysian Canvas ✨</h1>
            <p className="elysian-subtitle">Art for the Discerning Adult</p>
          </div>

          <div className="verification-form">
            <div className="warning-section">
              <div className="warning-icon">⚠️</div>
              <p className="warning-text">
                This section contains sophisticated artistic content intended
                for mature audiences. By proceeding, you confirm you are 18+ and
                understand the artistic nature of the content.
              </p>
            </div>

            <div className="form-group">
              <label htmlFor="birthYear">Birth Year:</label>
              <input
                id="birthYear"
                type="number"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                placeholder="YYYY"
                min="1900"
                max={new Date().getFullYear() - 18}
                className="birth-year-input"
              />
            </div>

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmAge}
                  onChange={(e) => setConfirmAge(e.target.checked)}
                />
                <span className="checkmark"></span>I confirm I am 18 years or
                older
              </label>
            </div>

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={artisticIntent}
                  onChange={(e) => setArtisticIntent(e.target.checked)}
                />
                <span className="checkmark"></span>I understand this is for
                artistic and creative purposes
              </label>
            </div>

            <button
              onClick={handleVerification}
              disabled={
                !birthYear || !confirmAge || !artisticIntent || isVerifying
              }
              className="verification-button"
            >
              {isVerifying ? (
                <span className="verifying-text">Confirming...</span>
              ) : (
                "Enter Elysian Canvas"
              )}
            </button>

            <p className="gate-disclaimer">
              This gate is a self-declaration, not an identity check. The app
              cannot verify your age, and the confirmation is cleared when the
              application closes.
            </p>
          </div>

          <div className="artistic-note">
            <p>
              "Art is the lie that enables us to realize the truth" - Pablo
              Picasso
            </p>
            {ephemeralIdValue && (
              <p className="ephemeral-id">Session reference: {ephemeralIdValue}</p>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .adult-gate-container {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .adult-gate-backdrop {
          width: 100%;
          height: 100%;
          background: linear-gradient(
            135deg,
            rgba(0, 0, 0, 0.95) 0%,
            rgba(20, 20, 40, 0.98) 50%,
            rgba(40, 20, 60, 0.95) 100%
          );
          backdrop-filter: blur(20px);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .adult-gate-content {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 40px;
          max-width: 500px;
          width: 90%;
          backdrop-filter: blur(15px);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
        }

        .gate-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .elysian-title {
          font-size: 2.5rem;
          background: linear-gradient(45deg, #ffd700, #ff6b6b, #4ecdc4);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin: 0;
          font-weight: 700;
        }

        .elysian-subtitle {
          color: rgba(255, 255, 255, 0.8);
          font-size: 1.1rem;
          margin: 10px 0 0 0;
          font-style: italic;
        }

        .warning-section {
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid rgba(255, 193, 7, 0.3);
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 25px;
          text-align: center;
        }

        .warning-icon {
          font-size: 2rem;
          margin-bottom: 10px;
        }

        .warning-text {
          color: rgba(255, 255, 255, 0.9);
          line-height: 1.5;
          margin: 0;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          color: rgba(255, 255, 255, 0.8);
          margin-bottom: 8px;
          font-weight: 500;
        }

        .birth-year-input {
          width: 100%;
          padding: 12px 16px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 8px;
          color: white;
          font-size: 1rem;
          outline: none;
          transition: all 0.3s ease;
        }

        .birth-year-input:focus {
          border-color: #4ecdc4;
          box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
        }

        .checkbox-group {
          margin-bottom: 20px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          color: rgba(255, 255, 255, 0.8);
          cursor: pointer;
          user-select: none;
        }

        .checkbox-label input[type="checkbox"] {
          margin-right: 12px;
          width: 18px;
          height: 18px;
          accent-color: #4ecdc4;
        }

        .verification-button {
          width: 100%;
          padding: 15px;
          background: linear-gradient(45deg, #4ecdc4, #44a08d);
          border: none;
          border-radius: 12px;
          color: white;
          font-size: 1.1rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          margin-bottom: 20px;
        }

        .verification-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(78, 205, 196, 0.3);
        }

        .verification-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .verifying-text {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .artistic-note {
          text-align: center;
          padding-top: 20px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .artistic-note p {
          color: rgba(255, 255, 255, 0.6);
          font-style: italic;
          margin: 0;
          font-size: 0.9rem;
        }

        .gate-disclaimer {
          margin-top: 16px;
          font-size: 0.78rem;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.55);
        }

        .ephemeral-id {
          margin-top: 10px;
          font-style: normal;
          font-family: monospace;
          font-size: 0.7rem;
          color: rgba(255, 255, 255, 0.4);
        }
      `}</style>
    </div>
  );
};
