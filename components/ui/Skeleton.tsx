import type { HTMLAttributes } from "react";

type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  rounded?: "lg" | "xl" | "full" | "none";
};

const radiusClass: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  none: "rounded-none",
  lg: "rounded-xl",
  xl: "rounded-2xl",
  full: "rounded-full",
};

export function Skeleton({ className = "", rounded = "xl", ...rest }: SkeletonProps) {
  const radius = radiusClass[rounded] ?? radiusClass.xl;

  return <div aria-hidden className={`skeleton ${radius} ${className}`.trim()} {...rest} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={`h-3 ${index === lines - 1 ? "w-1/2" : "w-full"}`}
          rounded="lg"
        />
      ))}
    </div>
  );
}
