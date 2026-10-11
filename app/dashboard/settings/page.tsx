import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 p-4 md:p-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Настройки</h1>
          <p className="text-sm text-muted-foreground">
            Команда, состояние системы и хранилище.
          </p>
        </header>
        <SettingsTabs />
      </div>
    </div>
  );
}
