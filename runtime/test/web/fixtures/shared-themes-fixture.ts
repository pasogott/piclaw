const skin = new URLSearchParams(location.search).get("skin") || "classic";
const root = document.getElementById("app")!;
const theme = await import("../../../web/src/ui/theme.js");
const { WEB_THEME_PRESETS } =
  await import("../../../src/core/ui-theme-catalogue.js");
const { paletteVariables } =
  await import("../../../web/src/ui/theme-palette.js");
const { terminalThemeFromCss } =
  await import("../../../web/src/ui/theme-terminal.js");
const { importVSCodeTheme, applyTheme, saveTheme, resetTheme, loadSavedTheme } =
  await import("../../../web/static/visual/frontend/src/utils/theme-importer");
const data = {
  uiTheme: "default",
  uiTint: null,
  themes: WEB_THEME_PRESETS.map((t) => ({
    name: t.id,
    label: t.label,
    mode: t.mode,
    colors: t.dark || t.light,
  })),
  colorKeys: ["bgPrimary", "textPrimary", "accent"],
};
window.fetch = async () => Response.json(data);
Object.assign(window, {
  themeFixture: {
    ...theme,
    importVSCodeTheme,
    applyTheme,
    saveTheme,
    resetTheme,
    loadSavedTheme,
    terminalThemeFromCss,
    paletteVariables,
    presets: WEB_THEME_PRESETS,
  },
});
if (skin === "classic") {
  const { html, render, useState } =
    await import("../../../web/src/vendor/preact-htm.js");
  const { ThemeSection } =
    await import("../../../web/src/components/settings/appearance.js");
  theme.initTheme({ skin: "classic" });
  function Fixture() {
    const [settings, setSettings] = useState(data);
    return html`<div class="settings-content">
      <${ThemeSection}
        themes=${data.themes}
        colorKeys=${data.colorKeys}
        settingsData=${settings}
        setStatus=${() => {}}
        mergeSettingsData=${(patch) => setSettings({ ...settings, ...patch })}
      />
    </div>`;
  }
  render(html`<${Fixture} />`, root);
} else {
  const { h, render } = await import("preact");
  const { ThemeProvider } =
    await import("../../../web/static/visual/frontend/src/theme/ThemeProvider");
  const { AppearanceSection } =
    await import("../../../web/static/visual/frontend/src/panels/settings/AppearanceSection");
  render(
    h(ThemeProvider, {
      children: h(
        "div",
        { className: "settings-panel__content" },
        h(AppearanceSection, { data, onSaveGeneral: () => {} }),
      ),
    }),
    root,
  );
}
const { highlightCodeToHtml } =
  await import("../../../web/src/utils/code-highlighting.js");
const probes = document.createElement("div");
probes.id = "theme-probes";
probes.innerHTML =
  '<p id="theme-prose">Ordinary text must not glow.</p><pre><code><span class="token keyword">const</span> value = <span class="token string">"fixture"</span> + <span class="token number">3</span>;</code></pre><button class="compose-send-btn">Send</button>';
const realCode = document.createElement("pre");
realCode.id = "theme-real-code";
realCode.innerHTML =
  "<code>" +
  highlightCodeToHtml(
    'const greeting = \"hello\"; let count = 3;',
    "javascript",
  ) +
  "</code>";
probes.append(realCode);
document.body.append(probes);
if (new URLSearchParams(location.search).get("terminal") === "1") {
  const { h, render } = await import("preact");
  const { TerminalComponent } =
    await import("../../../web/static/visual/frontend/src/components/TerminalComponent");
  const host = document.createElement("div");
  host.id = "real-terminal";
  host.style.cssText =
    "width:600px;height:240px;position:fixed;bottom:0;left:0;z-index:100;";
  document.body.append(host);
  render(h(TerminalComponent, {}), host);
}
