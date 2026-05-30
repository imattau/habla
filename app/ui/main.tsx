import { type ReactNode } from "react";
import { cn } from "~/lib/utils";

export default function Main({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "flex flex-col items-center w-full max-w-6xl px-4 sm:px-6 lg:px-8",
        className,
      )}
    >
      {children}
    </main>
  );
}
