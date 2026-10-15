## 1. The `plugin` channel of write-back (workspace OBS-024 group 11)

- [x] 1.1 (11.1) RED: `tests/apply-operation.test.ts` "base mismatch is reported, not applied", "rename uses fileManager.renameFile" and "operations apply in queue order", against a fake vault API (`tests/support/fake-obsidian.ts`) and a fake Edge that answers the device queue as `ratatoskr-notes` does. Confirm that they fail by assertion, because the plugin does not read the device queue.
- [x] 1.2 (11.2) GREEN: implement the pull loop, the base check, the apply step and the result report. Verify 1.1, and document the write behaviour in the `README.md`.
