import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";

/**
 * Compact colour parameter: swatch + hex input, with a react-colorful picker
 * expanded on demand. The hex input stays testable and keyboard editable, and
 * only valid #rrggbb values reach the processor.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const valid = /^#[0-9a-fA-F]{6}$/.test(draft);

  return (
    <div className="kx-field">
      <span className="kx-label">{label}</span>
      <div className="kx-color-row">
        <button
          type="button"
          className="kx-color-swatch"
          style={{ background: valid ? draft : value }}
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        />
        <input
          className="kx-input kx-color-hex"
          value={draft}
          spellCheck={false}
          aria-label={label}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            if (/^#[0-9a-fA-F]{6}$/.test(next)) onChange(next.toLowerCase());
          }}
        />
      </div>
      {open && (
        <div className="kx-color-pop" dir="ltr">
          <HexColorPicker
            color={valid ? draft : value}
            onChange={(next) => {
              setDraft(next);
              onChange(next);
            }}
          />
        </div>
      )}
    </div>
  );
}
