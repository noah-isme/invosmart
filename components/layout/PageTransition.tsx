"use client";

import * as FramerMotion from "framer-motion";
import { usePathname } from "next/navigation";
import { useMemo, type PropsWithChildren } from "react";

type MotionModule = typeof import("framer-motion") & {
  useReducedMotion?: () => boolean;
};

const motionModule = FramerMotion as MotionModule;
const { AnimatePresence, motion } = motionModule;

const resolvedUseReducedMotion:
  | MotionModule["useReducedMotion"]
  | (() => boolean) =
  "useReducedMotion" in motionModule &&
  typeof motionModule.useReducedMotion === "function"
    ? motionModule.useReducedMotion.bind(motionModule)
    : () => false;

export function PageTransition({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const reduceMotion = resolvedUseReducedMotion();

  const transition = useMemo(
    () => ({
      duration: reduceMotion ? 0.12 : 0.18,
      ease: "easeOut" as const,
    }),
    [reduceMotion],
  );

  const initial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 };
  const animate = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 };
  const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 };

  return (
    <AnimatePresence mode="sync" initial={false}>
      <motion.div
        key={pathname}
        data-testid="page-transition"
        initial={initial}
        animate={animate}
        exit={exit}
        transition={transition}
        className="h-full [will-change:opacity]"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
