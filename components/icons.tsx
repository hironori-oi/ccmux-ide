/**
 * lucide-react のアイコンを集約 re-export する場所。
 *
 * 組織ルール: Web では Heroicons を使う方針だが、本アプリは shadcn/ui 規約と
 * 合わせて lucide-react を採用。アプリ横断で使うアイコンを命名を揃えて
 * 再エクスポートすることで、将来の差し替え（例: Heroicons へ戻す）を 1 箇所に
 * 集約する。
 */
export {
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Command,
  Sparkles,
  RotateCcw,
  Settings,
  Send,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Folder,
  FolderOpen,
  Search,
  X,
  Loader2,
  CircleAlert,
  Info,
  MoonStar,
  Sun,
  Monitor,
  Plus,
  Minus,
  Trash2,
  Copy,
} from "lucide-react";
