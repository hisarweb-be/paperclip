# CI in this fork: the borrowed PR workflow is an external dependency

`.github/workflows/pr.yml` does not contain the CI definition. It calls
`paperclipai/paperclip/.github/workflows/pr-trusted.yml` as a reusable
workflow, so the jobs that run on a pull request come from *upstream*, not from
this tree. Only the `@ref` in `pr.yml` decides which version that is.

We pin that ref to an immutable commit SHA:

```
uses: paperclipai/paperclip/.github/workflows/pr-trusted.yml@59c07ede72dc08b8aba149a01cc11e0b7a204621
```

`59c07ede72dc08b8aba149a01cc11e0b7a204621` is the upstream commit this fork's
`master` is a snapshot of. The `pr-trusted.yml` in that commit is byte-identical
to the copy in this tree, so the workflow and the code it tests come from the
same tree.

## Runbook rule

When PR jobs fail on something the PR did not touch — a missing script, a
missing package script, a test group that "does not exist" — first measure the
drift, do not dig through the PR:

```bash
# 1. What ref does our caller pin, and when did upstream change the workflow?
grep -n 'pr-trusted.yml@' .github/workflows/pr.yml
gh api "repos/paperclipai/paperclip/commits?path=.github/workflows/pr-trusted.yml&sha=master&per_page=10" \
  --jq '.[] | "\(.sha[0:8]) \(.commit.author.date) \(.commit.message | split("\n")[0])"'

# 2. Is the borrowed version still the one that matches this tree?
gh api repos/paperclipai/paperclip/contents/.github/workflows/pr-trusted.yml?ref=<pinned-sha> \
  --jq '.content' | base64 -d | diff - .github/workflows/pr-trusted.yml && echo IDENTICAL
```

If the diff is empty, the workflow matches this tree and the red job is a real
failure in the PR. If the diff is not empty, we are running a workflow written
for a different tree: fix the pin (or catch the fork up), do not patch the PR.

Symptoms of that drift, seen on 2026-10-20 (HIS-3521) while the caller was on
`@master`:

| red job | cause |
|---|---|
| `ci / Build` | upstream runs `pnpm --filter @paperclipai/server build:runtime`, then `scripts/server-boot-smoke.sh`; neither exists in this snapshot (`exit 127`) |
| `ci / Docker context integrity` | upstream runs `scripts/docker-compose-secrets.test.mjs`, absent here |
| `ci / General tests (workspaces-c)` | upstream added group `general-workspaces-c` to `scripts/run-vitest-stable.mjs` |
| `ci / verify` | aggregator, fails along with the three above |

The PR's own compile/typecheck/test jobs pass in that situation — that is the
tell that the workflow, not the change, is the problem.

## Changing the pin

Only bump the SHA together with a catch-up of the fork to that same upstream
commit, because the pinned workflow expects the files of its own commit. In one
PR:

1. merge/port the upstream changes into the fork;
2. bump the SHA in `.github/workflows/pr.yml` to that upstream commit;
3. re-sync `.github/workflows/pr-trusted.yml` from that commit and verify it is
   byte-identical (diff above);
4. let CI run on the PR: the four jobs named above must be green.

Never point the caller back at `@master`. Upstream's own `pr.yml` can do that
because upstream's branch protection plus CODEOWNERS review holds the workflow
and the tree together; a fork has neither, so `@master` turns every later
upstream CI change into a red PR here.

## Not part of this

`review` (`commitperclip-review.yml`) is not the borrowed workflow and is not
covered by the pin. It fails at `Generate commitperclip token`
(`.github/scripts/get-bot-token.mjs` needs the `COMMITPERCLIP_KEY` secret, which
this fork does not have), so it fails independently of the diff. Treat it as its
own issue; do not read it as CI drift.
