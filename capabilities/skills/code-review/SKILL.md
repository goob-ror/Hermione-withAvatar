---
name: code-review
description: Review a change (diff, pull request or files) for real problems — correctness, security, data loss, edge cases — and report them by severity. Use when asked to review, check before merging, or audit code.
---

# Code review

1. **Get the change.** `git diff` / `git diff main...HEAD`, or the files the operator named. Read enough surrounding code to understand intent.
2. **Look for real problems first**, in this order:
   - Correctness: wrong logic, off-by-one, null/undefined paths, broken error handling, race conditions.
   - Security: injection, path traversal, secrets in code or logs, missing auth checks, unsafe deserialization.
   - Data loss or irreversible effects: deletes, overwrites, migrations without a way back.
   - Edge cases the change forgot (empty input, large input, Unicode, Windows paths, time zones).
3. **Then** clarity and maintainability — briefly, and only when it matters.
4. **Report** each finding with: file:line, what goes wrong (a concrete input → bad result), and the smallest fix. Most severe first. Say clearly when you found nothing serious — don't invent issues.
5. Don't rewrite the code unless asked; offer the fix.
