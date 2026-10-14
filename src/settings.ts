import { PluginSettingTab, Setting, type App } from 'obsidian';
import type RatatoskrPlugin from './main';

/** The settings tab: the Edge address, the device name, pairing and connect. */
export class RatatoskrSettingTab extends PluginSettingTab {
  readonly #plugin: RatatoskrPlugin;
  #code = '';

  constructor(app: App, plugin: RatatoskrPlugin) {
    super(app, plugin);
    this.#plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    const plugin = this.#plugin;
    containerEl.empty();
    containerEl.createEl('p', { text: plugin.core?.status ?? 'Enter the Edge address of your Ratatoskr.' });

    // The fields change a draft. Only Save applies it, so a half-typed address is never used.
    const draft = { ...plugin.config };
    new Setting(containerEl)
      .setName('Edge address')
      .setDesc('The HTTPS address of your Ratatoskr Edge. A new address needs a new pairing.')
      .addText((text) => text.setValue(draft.edgeUrl).onChange((value) => (draft.edgeUrl = value.trim())));
    new Setting(containerEl)
      .setName('Device name')
      .setDesc('The name that Ratatoskr shows for this device.')
      .addText((text) => text.setValue(draft.deviceName).onChange((value) => (draft.deviceName = value.trim())))
      .addButton((button) =>
        button.setButtonText('Save').onClick(async () => {
          await plugin.saveSettings(draft);
          this.display();
        }),
      );
    new Setting(containerEl)
      .setName('Pairing code')
      .setDesc('Make a pairing code in Ratatoskr, enter it here, and select Pair.')
      .addText((text) => text.onChange((value) => (this.#code = value.trim())))
      .addButton((button) =>
        button.setButtonText('Pair').onClick(async () => {
          await plugin.run((core) => core.pair(this.#code));
          this.display();
        }),
      );
    new Setting(containerEl)
      .setName('Connect this vault')
      .setDesc('Connects the vault through the plugin. A vault that uses Obsidian Sync gets status only.')
      .addButton((button) =>
        button.setButtonText('Connect').onClick(async () => {
          await plugin.run((core) => core.connect());
          this.display();
        }),
      );
  }
}
