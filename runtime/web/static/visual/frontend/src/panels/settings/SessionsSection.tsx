import { useSignal } from "@preact/signals";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";
import { CustomSelect } from "../../components/CustomSelect";

export function SessionsSection({
  data,
  onSaveGeneral,
}: {
  data: SettingsData;
  onSaveGeneral: (field: string, value: unknown) => void;
}) {
  const toolUseBudget = useSignal(data.toolUseBudget ?? 0);

  return (
    <section className="settings-panel__section settings-panel__section--sessions">
      <h2 className="settings-panel__section-title">Sessions</h2>

      <h3 className="settings-panel__subsection-title">Agent Behaviour</h3>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Tool use budget</label>
        <div className="settings-panel__field-content">
          <NumberStepper label="Tool use budget" value={toolUseBudget} min={8} max={512} onSave={(v) => onSaveGeneral("toolUseBudget", v)} />
          <span className="settings-panel__description">Max tool-call messages per turn</span>
        </div>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Session isolation</label>
        <div className="settings-panel__field-content">
          <CustomSelect
            value={data.sessionIsolation ?? "none"}
            options={[
              { value: "none", label: "None — full cross-session visibility" },
              { value: "summary", label: "Summary" },
              { value: "full", label: "Full" },
            ]}
            onChange={(val) => onSaveGeneral("sessionIsolation", val)}
          />
          <span className="settings-panel__description">Controls visibility between sessions</span>
        </div>
      </div>

    </section>
  );
}

registerSettingsPane({
  id: "sessions",
  label: "Sessions",
  icon: <i className="codicon codicon-terminal-bash" />,
  order: 12,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <SessionsSection data={data} onSaveGeneral={(field, value) => saveSetting("general", field, value)} />
  ),
});
