import { toast } from "sonner";

/**
 * sonner の薄いラッパー。shadcn の use-toast 互換の API を提供する。
 *
 * 用途: import の揺れをなくすため、全コンポーネントからは必ず
 * `import { useToast } from "@/hooks/use-toast"` で使う。
 */
export function useToast() {
  return {
    toast: {
      success: (message: string, description?: string) =>
        toast.success(message, { description }),
      error: (message: string, description?: string) =>
        toast.error(message, { description }),
      info: (message: string, description?: string) =>
        toast.info(message, { description }),
      warning: (message: string, description?: string) =>
        toast.warning(message, { description }),
      loading: (message: string) => toast.loading(message),
      dismiss: (id?: string | number) => toast.dismiss(id),
    },
  };
}
