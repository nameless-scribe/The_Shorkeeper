# The Shorekeeper Repository Instructions

All changes in this repository must comply with `docs/DEVELOPMENT-CONTRACT.md`. Read the relevant sections before editing and use it as the definition of done.

Non-negotiable rules:

- Extend nearby architecture and components; do not introduce a parallel UI, IPC, persistence, or tool system.
- New UI must reuse the existing `keeper-*` theme tokens and shared components, support all themes, and be visually checked in the actual Electron window.
- Renderer code must not access Node, secrets, or the database. Privileged IPC must use `trustedIpcMain` and validate `unknown` input at runtime.
- Database changes require a new ordered migration, schema/repository/docs updates, temporary-database tests, and preservation of WAL/backup safety. Automated tests must never touch real user data.
- Tools must declare side effects and obey permission, idempotency, cancellation, recovery, and evidence contracts. Never claim completion without verified results.
- Bug fixes require a regression test for the original failure path. Do not swallow errors or continue after mandatory initialization fails.
- Keep changes scoped and preserve unrelated user work. Never commit `.env`, secrets, databases, workspaces, logs, generated assets, or release output.
- Run the validation matrix in `docs/DEVELOPMENT-CONTRACT.md`; report skipped checks honestly and update affected documentation.

If a requested change conflicts with the contract, stop and explain the conflict instead of silently weakening a safety or consistency guarantee.
