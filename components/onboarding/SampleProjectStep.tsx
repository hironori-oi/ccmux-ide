"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FileCode, FileCode2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Step 4: サンプルプロジェクト（PM-125）。
 *
 * `public/sample-projects/{node-hello,python-hello}/` をユーザー指定先へコピー
 * する簡易機能。Tauri の dialog + fs plugin を使う。
 *
 * NOTE: Next.js の `public/` は Tauri の static asset として同梱されるが、
 *       runtime では FS パスが取れない（asset protocol 経由）ため、
 *       実運用では Rust 側に「サンプルコピー command」を用意するのが望ましい。
 *       本ステップでは MVP として、ユーザー選択先にファイルを 1 つずつ書き出す
 *       簡易実装（テンプレート文字列を直書きして writeTextFile）とする。
 */
export interface SampleProjectStepProps {
  /** 選択 or スキップで完了 */
  onComplete: () => void;
}

type SampleKind = "node" | "python";

export function SampleProjectStep({ onComplete }: SampleProjectStepProps) {
  const [busy, setBusy] = useState<SampleKind | null>(null);

  async function handleCopySample(kind: SampleKind) {
    setBusy(kind);
    try {
      // ユーザーに保存先ディレクトリを選ばせる
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "サンプルを配置するフォルダを選んでください",
      });
      if (!selected || typeof selected !== "string") {
        setBusy(null);
        return;
      }

      const { writeTextFile, mkdir, exists } = await import(
        "@tauri-apps/plugin-fs"
      );

      // 選択先にサンプル名のサブディレクトリを掘る
      const subDir =
        kind === "node" ? "node-hello" : "python-hello";
      const targetDir = joinPath(selected, subDir);

      if (!(await exists(targetDir))) {
        await mkdir(targetDir, { recursive: true });
      }

      const files = SAMPLE_FILES[kind];
      for (const [name, content] of Object.entries(files)) {
        await writeTextFile(joinPath(targetDir, name), content);
      }

      toast.success(`サンプルを作成しました: ${targetDir}`);
      onComplete();
    } catch (e) {
      toast.error(`サンプルの作成に失敗しました: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  function handleSkip() {
    onComplete();
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          サンプルで試してみる
        </h2>
        <p className="text-sm text-muted-foreground">
          最小の Hello World プロジェクトを作成できます。あとで削除しても問題ありません。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileCode className="h-5 w-5" aria-hidden />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Node サンプル</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Node.js の最小 Hello World。package.json と index.js を作成します。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => handleCopySample("node")}
            disabled={busy !== null}
          >
            {busy === "node" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Node サンプルを試す
          </Button>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileCode2 className="h-5 w-5" aria-hidden />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">Python サンプル</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Python の最小 Hello World。pyproject.toml と main.py を作成します。
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => handleCopySample("python")}
            disabled={busy !== null}
          >
            {busy === "python" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            Python サンプルを試す
          </Button>
        </Card>
      </div>

      <div className="flex justify-center">
        <Button
          variant="ghost"
          onClick={handleSkip}
          disabled={busy !== null}
          className="text-muted-foreground"
        >
          スキップ（ワークスペースを開く）
        </Button>
      </div>
    </div>
  );
}

/**
 * シンプルな path 結合。Tauri fs API は OS セパレータを自動で解釈するので
 * `/` 区切りで投げれば Windows でも動く（内部で PathBuf 化）。
 */
function joinPath(a: string, b: string): string {
  const sep = a.includes("\\") ? "\\" : "/";
  const trimmed = a.endsWith(sep) ? a.slice(0, -1) : a;
  return trimmed + sep + b;
}

/**
 * サンプルプロジェクトのテンプレート内容を直書き。
 *
 * `public/sample-projects/` にも同じ内容のファイルを置いてあるが、Tauri の
 * asset protocol 経由のコピーは扱いが面倒なので MVP では文字列埋め込みで対応。
 */
const SAMPLE_FILES: Record<"node" | "python", Record<string, string>> = {
  node: {
    "package.json": `{
  "name": "node-hello",
  "version": "0.1.0",
  "description": "Minimal Node.js hello world for ccmux-ide",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "license": "MIT"
}
`,
    "index.js": `// Minimal Node.js sample for ccmux-ide.
// Run: npm start
console.log("Hello from ccmux-ide (Node).");
`,
    "README.md": `# node-hello

ccmux-ide 同梱の最小 Node.js サンプルです。

## 実行方法

\`\`\`sh
npm start
\`\`\`
`,
  },
  python: {
    "pyproject.toml": `[project]
name = "python-hello"
version = "0.1.0"
description = "Minimal Python hello world for ccmux-ide"
requires-python = ">=3.9"
license = { text = "MIT" }
`,
    "main.py": `"""Minimal Python sample for ccmux-ide.

Run: python main.py
"""

if __name__ == "__main__":
    print("Hello from ccmux-ide (Python).")
`,
    "README.md": `# python-hello

ccmux-ide 同梱の最小 Python サンプルです。

## 実行方法

\`\`\`sh
python main.py
\`\`\`
`,
  },
};
