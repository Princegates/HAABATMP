# Exam-day capacity

What happens when a whole class starts, saves and submits an exam at the same moment, and when many people download certificates
at once. Everything below was measured with the load tests in `apps/api/test/load/` against a database 10 ms away (about what a
hosted database costs per round trip). Run them yourself after any change to the exam or PDF code:

```bash
cd apps/api
DATABASE_URL=postgres://... AUTH_MODE=dev NODE_ENV=test DB_LATENCY_MS=5 node test/load/exam-load.mjs 150 40   # trainees, questions
DATABASE_URL=postgres://... AUTH_MODE=dev NODE_ENV=test node test/load/pdf-load.mjs 30                          # downloads
```

Use a throw-away database. The scripts create their own people and exams.

## Exam: everyone at the same moment (slowest request)

| Step | 60 trainees before | 60 after | 150 after | 400 after (pool 25) |
|---|---|---|---|---|
| Start the exam | 7.3 s | 1.3 s | 3.0 s | 6.1 s |
| Save answers (autosave) | 3.1 s | 0.4 s | 1.0 s | 1.4 s |
| Submit | 3.8 s | 1.0 s | 2.3 s | 5.6 s |

What was changed:

- **Start** locked the exam row for update, so trainees started one after another. It is now share-locked, and only a double click by the same
  trainee is serialised. The audit entry is written last, so the audit chain's lock is held for the shortest time.
- **Autosave and submit** wrote one database row per answer. They now write the whole paper in one statement.

What is left: every audited step takes the audit chain's lock, one at a time, for about one commit (roughly 14 ms with a hosted database).
That is the ceiling shown in the 400 column (about 70 audited steps a second). A class of 150 finishes within about 3 seconds. The trainee's
answers are saved all the way through, so a slow start or submit never loses work.

Set `DATABASE_POOL_MAX=20` on the API service (default 10). It roughly halves the autosave time at 400 trainees.

## Certificate PDFs

Building one takes about 0.45 s of processor time and cannot be interrupted, so 30 at once froze the whole server for about 11 seconds,
including trainees saving answers.

- The PDF is **stored once** under a key that contains a hash of everything printed on it. A changed name, title or template makes a new key,
  so nobody is handed an old copy. Older copies stay in storage unused (about 200 KB each).
- Builds run **one at a time**, so other requests get a turn between two PDFs (the longest wait is now about 0.6 s).
- The 15-minute job **prepares up to 40 missing certificates** per run, away from the web server, so most downloads are a file read.
- Invoices and receipts are not stored (their content changes with every payment) but use the same one-at-a-time queue.

Measured: 30 downloads, none stored: the server stays responsive (longest wait 0.6 s). 30 downloads, already stored: all done in 0.22 s.
