import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  type?: "default" | "alert" | "prompt" | "preview" | "settings";
  size?: "sm" | "md" | "lg" | "xl";
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  closeOnBackdrop?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Single accessible dialog implementation used by every panel.
 * Handles Escape, focus trapping/restoration, body scroll locking and
 * backdrop dismissal in one place.
 */
const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  type = "default",
  size = "md",
  footer,
  children,
  className = "",
  closeOnBackdrop = true,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousFocus.current = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const nodes = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((node) => node.offsetParent !== null);
      if (nodes.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const timer = window.setTimeout(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      target?.focus();
    }, 20);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = originalOverflow;
      window.clearTimeout(timer);
      previousFocus.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // A route ancestor may carry a transform/filter, which would scope
  // position:fixed to that container and clip the dialog. Portaling to
  // document.body keeps every dialog centred over the whole window.
  return createPortal(
    <div
      className="knoux-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : "Dialog"}
        tabIndex={-1}
        className={`knoux-modal knoux-modal-${type} ${SIZE_CLASSES[size]} ${className}`}
      >
        {(title || type !== "alert") && (
          <header className="knoux-modal-header">
            <h2 className="knoux-modal-title">{title}</h2>
            <button
              type="button"
              aria-label="Close dialog"
              className="knoux-icon-button"
              onClick={onClose}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </header>
        )}
        <div className="knoux-modal-body">{children}</div>
        {footer && <footer className="knoux-modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
