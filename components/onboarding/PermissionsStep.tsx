"use client";

import {
  FileText,
  Terminal,
  ImageIcon,
  Database,
  ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * Step 3: 権限確認（PM-124）。
 *
 * DEC-021 差別化軸 D「ローカル永続化・プライバシー重視」の訴求ポイント。
 * Claude の操作範囲を箇条書きで明示し、テレメトリが無い事を強調する。
 */
export function PermissionsStep() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Claude の操作範囲を確認
        </h2>
        <p className="text-sm text-muted-foreground">
          すべての処理はあなたの PC 内で完結します。テレメトリは送信しません。
        </p>
      </div>

      <Card className="space-y-4 p-6">
        <PermissionItem
          icon={<FileText className="h-4 w-4" aria-hidden />}
          title="ファイル読取"
          desc="閲覧中のプロジェクトディレクトリ配下のみ読み取ります。"
        />
        <PermissionItem
          icon={<Terminal className="h-4 w-4" aria-hidden />}
          title="コマンド実行"
          desc="コマンドはあなたの承認後にのみ実行されます。"
        />
        <PermissionItem
          icon={<ImageIcon className="h-4 w-4" aria-hidden />}
          title="画像の保存先"
          desc="貼付された画像は ~/.ccmux-ide-gui/images/ に保存されます。"
        />
        <PermissionItem
          icon={<Database className="h-4 w-4" aria-hidden />}
          title="ローカル DB"
          desc="会話履歴は ~/.ccmux-ide-gui/history.db にのみ保存します。外部送信はありません。"
        />
      </Card>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
        <span>テレメトリなし、解析サービスなし、クラウド同期なし。</span>
      </div>
    </div>
  );
}

function PermissionItem({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-0.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}
