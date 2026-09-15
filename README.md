# two-way-mirror

Keeps `develop` in sync between two remotes:

| | |
|---|---|
| GitLab | `git@git.clicker.team:nikola.nemes/two-way-empty.git` |
| GitHub | `git@github.com:NikolaNemes/two-way-empty.git` |

A push to `develop` on either remote triggers that remote's CI, which runs
`sync.sh` to **fast-forward** `develop` on the *other* remote.

## Rules

`sync.sh` only ever does a fast-forward push. Outcomes:

| Situation | Result |
|---|---|
| Target has no `develop` | creates it, exit 0 |
| Same SHA | no-op, exit 0 |
| Target is strictly behind | fast-forward push, exit 0 |
| Target is strictly ahead | no-op, exit 0 |
| Diverged | **error**, exit 1, nothing pushed |

No force-push, no merge, no rebase. Ever.

Loops terminate on their own: the mirroring push fires the other side's CI, which
sees identical SHAs and exits 0 without pushing.

## Setup

### 1. Deploy keys

Generate one keypair per direction (the private key lives in the *pushing* side's
CI, the public key is installed as a write-enabled deploy key on the *receiving* side):

```sh
ssh-keygen -t ed25519 -N '' -C 'mirror gh->gl' -f gh-to-gl
ssh-keygen -t ed25519 -N '' -C 'mirror gl->gh' -f gl-to-gh
```

**GitHub → GitLab**
- GitLab project → Settings → Repository → Deploy keys → add `gh-to-gl.pub`, **grant write access**.
- GitHub repo → Settings → Secrets and variables → Actions:
  - `MIRROR_SSH_KEY` = contents of `gh-to-gl` (private)
  - `MIRROR_KNOWN_HOSTS` = output of `ssh-keyscan git.clicker.team`

**GitLab → GitHub**
- GitHub repo → Settings → Deploy keys → add `gl-to-gh.pub`, tick **Allow write access**.
- GitLab project → Settings → CI/CD → Variables (mark *Masked* where possible, **untick "Protect variable"** unless `develop` is a protected branch):
  - `MIRROR_SSH_KEY` = contents of `gl-to-gh` (private), type **Variable**
  - `MIRROR_KNOWN_HOSTS` = output of `ssh-keyscan github.com`

`MIRROR_KNOWN_HOSTS` is optional; without it `sync.sh` falls back to `ssh-keyscan`
at runtime (trust-on-first-use). Pin it for anything real.

### 2. Seed the repos

```sh
git remote add gitlab git@git.clicker.team:nikola.nemes/two-way-empty.git
git remote add github git@github.com:NikolaNemes/two-way-empty.git
git push gitlab develop
git push github develop
```

Both CI configs must be present on `develop` on *both* remotes — seeding from this
repo does that.

## Running it locally

```sh
MIRROR_TARGET_URL=git@github.com:NikolaNemes/two-way-empty.git BRANCH=develop ./sync.sh
```

Uses your ambient ssh agent when `MIRROR_SSH_KEY` is unset.
