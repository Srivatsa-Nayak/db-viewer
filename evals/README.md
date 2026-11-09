# Schema assistant evals

A small, repeatable check of the assistant's answers, to run whenever the prompt, the model or the
provider changes. It talks to a running backend exactly as the UI does.

## What it checks

It applies three bundled templates (`ecommerce`, `blog`, `library` by default) to fresh
workspaces, then asks six questions about each: eighteen in all. Every answer is graded by a
deterministic check, with no second model judging the first.

| Case | Passes when |
|---|---|
| `summary` | The answer names at least two of the file's real tables |
| `fake-column` | Asked about a column that does not exist, it says so |
| `fake-table` | Asked about a table that does not exist, it says so |
| `no-data` | Asked for row values, it says it can only see the schema |
| `add-column-sql` | The SQL it writes **runs** in the scratchpad |
| `retype-sql` | The SQLite DDL for a type change **runs** (this is the table-rebuild case) |

The two SQL cases run the answer's `sql` block through `POST /scratchpad`, against the template's
own data, so "runnable" means it actually ran.

## Running it

Every question is a real model call and costs money. One full run is 18 calls. The app key's
default limit is 20 questions an hour per user, so either use your own key or raise the limit on
a local backend.

Start the backend:

```bash
cd db-viewer-backend && ./mvnw spring-boot:run
```

Then, from the repository root, with your OpenRouter key:

```bash
EVAL_OPENROUTER_KEY=sk-or-... EVAL_MODEL=openai/gpt-4o node evals/run-evals.mjs
```

| Variable / flag | Default | Meaning |
|---|---|---|
| `EVAL_OPENROUTER_KEY` | *(none)* | Saved as the eval account's own key, so the app key is not used |
| `EVAL_MODEL` | provider default | Model id for that key, e.g. `openai/gpt-4o`, `anthropic/claude-sonnet-4.5` |
| `EVAL_EMAIL` / `EVAL_PASSWORD` | an eval-only account | Signed up on first run |
| `--base` / `EVAL_BASE_URL` | `http://localhost:8080` | Which backend to test |
| `--templates` | `ecommerce,blog,library` | Comma-separated template ids (see `GET /templates`) |

The run prints a PASS/FAIL table, writes full questions and answers to
`evals/results/<timestamp>.json`, and exits with 1 when any case failed. The `results/` folder is
gitignored.

Comparing models is the main use: run it once per `EVAL_MODEL` and compare the pass counts, and
read the failing answers in the JSON. The regular expressions behind the text checks are
deliberately broad. A failure is worth reading before it is believed.
