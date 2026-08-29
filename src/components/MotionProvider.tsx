import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { useReducedMotionSetting } from "../reducedMotion";
import { TooltipHost } from "./Tooltip";

/* Wraps every window root. "user" respects the OS-level prefers-reduced-motion
   setting from this one place; "always" additionally honors the in-app
   Settings toggle. There is no third option that forces motion on against
   the OS setting — see reducedMotion.ts for why.

   Also mounts one TooltipHost per window — the single place that needs
   touching to give every window (main, Add, Details, Archive, About) the
   same custom `data-tip` tooltip layer. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotionSetting();
  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      {children}
      <TooltipHost />
    </MotionConfig>
  );
}

export default MotionProvider;
