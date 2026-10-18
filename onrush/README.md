# Onrush Awareness — fork notes

This branch (`onrush`) is **Onrush Awareness**, an open-source intelligence dashboard by Onrush
Data LLC at `awareness.onrushdata.com`.

**Based on [World Monitor](https://github.com/koala73/worldmonitor)** by Elie Habib, licensed
under the GNU Affero General Public License v3.0 only (see [`LICENSE`](../LICENSE)). Onrush
Awareness is a modified version. Its complete corresponding source is this repository's
`onrush` branch. Upstream's copyright, licence and attribution notices are kept as they are.
Onrush Awareness is not affiliated with or endorsed by World Monitor; its name and brand are
Onrush's own, per upstream's
[trademark policy](https://github.com/koala73/worldmonitor/blob/main/docs/trademark-policy.mdx).

## Never push upstream

**Nothing from this fork goes to `koala73/worldmonitor`.** No pushes of any branch, no pull
requests (including GitHub's "Contribute" button), no issues opened on Onrush's behalf. The
upstream remote is fetch-only. Every checkout disables its push URL, as shown under *Local
checkout*. Changes flow one way: upstream → `main` → `onrush`.

## Branch model

| Branch | Role |
|---|---|
| `main` | Mirrors upstream `koala73/worldmonitor` `main`. Never commit here; update it with GitHub's **Sync fork**, or `git fetch upstream` then `git merge --ff-only upstream/main` |
| `onrush` | Our trunk and deploy branch. Takes upstream by merging `main` into it, never by rebasing |

To keep upstream merges cheap:
- Onrush additions live under `onrush/`, or in new files such as an `onrush` site variant.
- An upstream file is edited only when there is no additive way. Each such edit is listed in
  the ledger below.

### Upstream-file edits ledger

| File | Why | Since |
|---|---|---|
| *(none yet)* | | |

## Local checkout

The repository is large: about 8,200 files and a 236 MB checkout.

```powershell
git clone https://github.com/CannonWest/worldmonitor C:/Users/Canno/CannonGround/sites/onrush-awareness
cd C:/Users/Canno/CannonGround/sites/onrush-awareness
git remote add upstream https://github.com/koala73/worldmonitor
git remote set-url --push upstream no_push--never-push-upstream
git checkout onrush
```

`git remote -v` must show `upstream ... no_push--never-push-upstream (push)`. Any push to
upstream then fails locally, before it reaches GitHub.

## Holding page (milestone OA-M0)

The lean port is proceeding one area at a time. Area 1 adds the tested Worker
[startup boundary](startup.md). Area 2 wires it into a [reference dashboard](dashboard.md)
using the upstream map renderers and bundled data. Deploy the current dashboard
with the configuration in [startup.md](startup.md#deployment). Owned live-feed
producers follow separately.

`onrush/holding/` preserves the original no-script holding page and its assets-only Worker configuration named
`onrush-awareness` on the custom domain `awareness.onrushdata.com`. Milestone OA-M1 reuses
that Worker name for the real build, so the domain never moves.

1. **First, put Cloudflare Access in front of the hostname.** Zero Trust → Access →
   Applications → Add → Self-hosted:
   - Domain: `awareness.onrushdata.com`.
   - Policy: Allow, by email (the operator's address), with the one-time PIN login method.

   With Access in place before the deploy, the page is never public, not even for a minute.
2. Then deploy from the repository root, logged in with `npx wrangler login`:

   ```powershell
   npx wrangler deploy -c onrush/holding/wrangler.jsonc
   ```

   The first deploy creates the custom-domain DNS record on the `onrushdata.com` zone.
3. Check it once in a browser: you get the Access login, then the holding page. A
   `curl -sI https://awareness.onrushdata.com` should answer with a redirect to
   `*.cloudflareaccess.com`, not a 200.
