import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/**
 * A slim top-of-viewport loading bar that appears whenever any TanStack Query
 * request is in flight. Gives users a premium "browser-native" feel of
 * activity without being intrusive.
 */
export function NavigationProgress() {
  const isFetching = useIsFetching();
  const isLoading = isFetching > 0;

  const [visible, setVisible] = useState(false);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout>;
    let wideTimer: ReturnType<typeof setTimeout>;

    if (isLoading) {
      setVisible(true);
      // Give the bar a moment to appear at narrow width before expanding
      wideTimer = setTimeout(() => setWide(true), 30);
    } else {
      // Complete to full width, then fade out
      setWide(true);
      hideTimer = setTimeout(() => {
        setVisible(false);
        setWide(false);
      }, 400);
    }

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(wideTimer);
    };
  }, [isLoading]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[9999] h-[2px] pointer-events-none overflow-hidden"
    >
      <div
        className={cn(
          "h-full bg-gradient-to-r from-primary via-primary/80 to-primary transition-[width,opacity] ease-out",
          isLoading && wide
            ? "w-4/5 duration-[8000ms]"
            : isLoading
              ? "w-0 duration-0"
              : "w-full duration-300",
          !isLoading && "opacity-0 duration-300",
        )}
      />
    </div>
  );
}
