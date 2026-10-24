import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * Accessible tooltips for icon-only controls.
 *
 * Built on Radix Tooltip (MIT). The trigger must be a single element that
 * accepts a ref — the KNOUX buttons and icon buttons do. The content is
 * portaled and styled with the design-system tokens; nothing loads remotely.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={380} skipDelayDuration={140}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function KxTooltip({
  label,
  children,
  side = "bottom",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          className="kx-tooltip"
          side={side}
          sideOffset={8}
          collisionPadding={10}
        >
          {label}
          <TooltipPrimitive.Arrow className="kx-tooltip-arrow" width={10} height={5} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
