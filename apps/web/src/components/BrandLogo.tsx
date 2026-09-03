import { cn } from "./ui";

export function BrandLogo({ className }: { className?: string }) {
  return (
    <img
      src="/logo-gota.png?v=2"
      alt=""
      className={cn("h-12 w-12 shrink-0 object-contain", className)}
      aria-hidden
    />
  );
}
