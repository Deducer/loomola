# Releasing Loomola

One release per `v*` tag. Two workflows fire on the tag and assemble a
single GitHub Release:

- `docker-publish.yml` — pushes `ghcr.io/deducer/loomola:<version>` and
  creates the Release with generated notes + a CHANGELOG pointer.
- `desktop-release.yml` — attaches `Loomola-<version>.dmg` (signed +
  notarized when secrets are present; `-unsigned.zip` otherwise).

Both use `softprops/action-gh-release`, which updates an existing release
for the tag and appends assets — so creation order doesn't matter. If the
two jobs race on the *initial* creation and one fails with an API
conflict, just re-run that job; it will append to the now-existing release.

## Procedure

1. CI green on `main`; working tree clean.
2. Move the `## Unreleased` items in `CHANGELOG.md` into a new
   `## v<X.Y.Z> — <date>` section; commit.
3. Confirm version sync: `package.json` `version` and
   `desktop/App/Info.plist` `CFBundleShortVersionString` match the tag
   you are about to create (the desktop workflow also stamps the bundle
   from the tag at build time, so the plist is belt-and-braces).
4. Tag and push (the only step that publishes anything):

   ```bash
   git tag v<X.Y.Z>
   git push origin v<X.Y.Z>
   ```

5. Watch both workflow runs; verify the Release has the DMG (or
   `-unsigned.zip`) attached and the GHCR package shows the version tag.

## v1.0.0 specifically

**Deferred:** `v1.0.0` is tagged at the END of Phase 6 (hygiene & docs),
after the full compose-from-scratch run and the recorded unassisted-setup
acceptance test — not when this file lands. Everything above is already
wired so that tag is a one-command act.
