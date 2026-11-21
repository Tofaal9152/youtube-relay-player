# Contributing

Bug reports, documentation improvements and pull requests are welcome.

1. Fork and clone the repository. Read [AGENTS.md](AGENTS.md) for the architecture and coding-assistant instructions.
2. Follow the local setup in the README.
3. Keep changes focused and describe the behavior they change.
4. Run `npm test`, `npm run typecheck` and `npm run build`.
5. For relay changes, start both services and run `npm run smoke`.

Do not include cookies, environment files, API keys, private video links, or upstream signed media URLs in issues or pull requests. Use the public test clip to reproduce relay problems when possible. Report whether the failure affects the test clip, YouTube extraction, or both.

Changes that process network input should include meaningful validation coverage. UI-only changes should include a screenshot and a short description of the playback checks performed.

Your contributions are licensed under the project's MIT license. Dependencies retain their own licenses.

For documentation-only changes, verify the instructions and links and run `git diff --check`; application tests/builds are not required. Keep AGENTS.md and the affected guides aligned when changing architecture, configuration or public behavior.
