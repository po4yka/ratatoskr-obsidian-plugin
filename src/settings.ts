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

    new Setting(containerEl)
      .setName('Edge address')
      .setDesc('The HTTPS address of your Ratatoskr Edge.')
      .addText((text) =>
        text.setValue(plugin.config.edgeUrl).onChange(async (value) => {
          plugin.config.edgeUrl = value.trim();
          await plugin.saveSettings();
        }),
      );
    new Setting(containerEl)
      .setName('Device name')
      .setDesc('The name that Ratatoskr shows for this device.')
      .addText((text) =>
        text.setValue(plugin.config.deviceName).onChange(async (value) => {
          plugin.config.deviceName = value.trim();
          await plugin.saveSettings();
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
