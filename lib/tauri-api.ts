import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Tauri backend の `#[tauri::command]` を型安全に呼び出すラッパー。
 *
 * Next.js 側から Rust command を叩くときは必ずこの関数経由にすること。
 * エラーは Rust 側で `Result<T, String>` として返されるので throw されたものを
 * UI 側で `toast.error` 等に流す。
 */
export async function callTauri<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  return invoke<T>(cmd, args);
}

/**
 * Rust 側から `AppHandle::emit(event, payload)` で送られるイベントを購読する。
 *
 * 戻り値の `UnlistenFn` を useEffect の cleanup で呼ぶこと（メモリリーク防止）。
 */
export function onTauriEvent<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  return listen<T>(event, (e) => handler(e.payload));
}
