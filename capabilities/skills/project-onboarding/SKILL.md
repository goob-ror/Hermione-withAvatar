---
name: project-onboarding
description: Get oriented in a project folder (e.g. one picked with @) before working in it — what it is, how it's built, run and tested. Use at the start of work in an unfamiliar project.
---

# Project onboarding

1. `fs_list .` — the top level. Then read, if present: `README*`, `package.json` / `pyproject.toml` / `Cargo.toml` / `*.csproj` / `default.project.json`, `CLAUDE.md` / `AGENTS.md`, and any `PLAN.md` / `docs/`.
2. Work out, in a few lines each:
   - **What it is** (app, library, game, tool) and its main language/framework.
   - **How to run it** and **how to test it** (scripts, commands).
   - **Where things live** (source, tests, config, assets).
   - **Conventions** you must follow (formatting, lint, commit style) from config files and docs.
3. Check its state: `git status` and `git log --oneline -5` if it's a repo.
4. Give the operator a short summary (5–8 lines) and confirm the task before changing anything.
5. Don't install dependencies or run long builds just to look around — ask first.
