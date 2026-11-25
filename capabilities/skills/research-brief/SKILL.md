---
name: research-brief
description: Research a question across several sources and write a short, cited brief. Use for comparisons, "what's the best…", market or product research, and anything where one source isn't enough.
---

# Research brief

1. **Frame it.** Restate the question in one line and list the 2–5 independent parts it splits into (one per product, source, region or angle). If a part is ambiguous in a way that changes the answer, ask with `ask_user` first.
2. **Fan out.** Give each part to a worker with `delegate` in the same turn — complete, specific tasks ("Find the current price in Indonesia (IDR) of X from at least two shops; report shop, price, date"). Do quick single lookups yourself.
3. **Check.** Compare the reports. Where workers disagree or a number looks off, verify it yourself with `web_fetch` on the cited source. Prefer primary sources (official sites, docs, filings) over aggregators.
4. **Write the brief.**
   - One-line answer first.
   - A compact table or list for comparisons (exact numbers, with units and dates).
   - What's uncertain or couldn't be found — say so plainly.
   - Sources: the URLs you actually used.
5. Keep it short. No filler, no restating the question.
