# Storyboards

WordPress plugin for mobile-first video storyboards: boards, scenes, reference photos, shot list + timeline overview.

**Repository:** [hjherbst/storyboard](https://github.com/hjherbst/storyboard)

## Install

1. Download `storyboards.zip` from the [latest release](https://github.com/hjherbst/storyboard/releases/latest)
2. WordPress → Plugins → Add New → Upload
3. Activate

Or clone into `wp-content/plugins/storyboards/`.

## Updates

Sites with the plugin active check [GitHub Releases](https://github.com/hjherbst/storyboard/releases) automatically (via [plugin-update-checker](https://github.com/YahnisElsts/plugin-update-checker)). Admins see the normal WordPress update UI.

## Release a new version

1. Bump **both**:
   - `Version:` in `storyboards.php`
   - `Stable tag:` in `readme.txt`
2. Commit and push to `main`
3. Tag and push:

```bash
git tag v1.0.2
git push origin v1.0.2
```

GitHub Actions builds `storyboards.zip` and publishes a Release. WordPress instances pick up the update on the next check.

## Local URL (Local WP)

Admin Bar → **Storyboards**, or `/storyboards/` while logged in as an administrator.
