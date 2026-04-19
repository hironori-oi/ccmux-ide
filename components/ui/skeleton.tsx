import { cn } from "@/lib/utils";

/**
 * shadcn/ui Skeleton — 公式仕様準拠のプレースホルダ。
 */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
