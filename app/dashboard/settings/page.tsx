import { PlatformStatusPanel } from "@/components/settings/platform-status-panel";

export default function SettingsPage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <h1 className="text-xl font-semibold">Настройки</h1>
      <PlatformStatusPanel />
    </div>
  );
}
