=== Storyboards ===
Contributors: strgl
Tags: storyboard, video, shotlist, production
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 1.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Mobile-first storyboards for video production. Collect shots, scripts, and reference photos.

== Description ==

Storyboards helps you plan videos on your phone:

* Create boards with 16:9 or 9:16 aspect ratio
* Add scenes with optional photo, duration, description, and script
* Label scenes as A-Roll, B-Roll, or Voiceover
* Reorder scenes in a shot list
* Toggle a timeline overview (sequential lanes, no overlap editing yet)

Open the app from the Admin Bar → **Storyboards**, or visit `/storyboards/` while logged in as an administrator.

Images are compressed in the browser (WebP, max 420px longest edge, target ≤ 70KB) before upload.

== Premium (coming soon) ==

AI-assisted description, script, and image generation will be available via STRGL.de licensing.
The free plugin ships with feature hooks (`storyboards_feature_enabled`) and disabled UI placeholders only.
No AI API calls are made in this version.

Future integration notes:

* License validation: `POST https://strgl.de/api/v1/licenses/validate`
* AI proxy endpoints will be added on STRGL (not available yet)

== Installation ==

1. Upload the `storyboards` folder to `/wp-content/plugins/` (or install `storyboards.zip` from GitHub Releases)
2. Activate the plugin through the Plugins screen
3. Open **Storyboards** from the Admin Bar

Updates are delivered from GitHub Releases (https://github.com/hjherbst/storyboard/releases).

== Changelog ==

= 1.0.1 =
* Prevent accidental loss of unsaved board/scene drafts (no overlay dismiss, confirm discard, keep form state across photo pick, handle browser back)

= 1.0.0 =
* Initial free MVP: boards, scenes, client WebP compression, list/timeline views, premium stubs
