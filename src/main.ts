import { Plugin } from 'obsidian';

// The entry point that Obsidian loads. It stays a thin adapter: the behaviour lives in modules
// that do not import `obsidian` at run time, so the tests can run them without the app.
export default class RatatoskrPlugin extends Plugin {
  override async onload(): Promise<void> {
    this.addStatusBarItem().setText('Ratatoskr: not paired');
  }
}
