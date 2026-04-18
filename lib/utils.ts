import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 公式のユーティリティ。
 * `cn(base, conditional && "x", "y")` のように条件付きクラスを安全にマージする。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
