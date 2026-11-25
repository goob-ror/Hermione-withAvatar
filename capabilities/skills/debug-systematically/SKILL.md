---
name: debug-systematically
description: Find and fix a bug methodically — reproduce, isolate, fix the root cause, verify. Use for errors, failing tests, crashes and "it doesn't work" reports.
---

# Debug systematically

1. **Reproduce.** Get the exact error: run the failing command/test and read the full output (`terminal_run`, `shell_run`, or the operator's paste). No guessing from the symptom alone.
2. **Read before changing.** Open the code the stack trace points to (`fs_read`) and the code that calls it. Note your hypothesis in one sentence.
3. **Isolate.** Narrow to the smallest failing case: one test, one input, one function. Check recent changes (`git diff`, `git log -5`) when it "used to work".
4. **Fix the root cause**, not the symptom. Keep the change as small as the cause; no drive-by refactors.
5. **Verify.** Re-run the exact reproduction, then the related tests. Only say it's fixed after it passes — and show the passing output.
6. **Report.** What was wrong (one or two sentences), what you changed (files), how you verified it, and anything left uncertain.

If you're stuck after two hypotheses, say what you tried and ask for the missing piece instead of thrashing.
