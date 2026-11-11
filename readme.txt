=== Storyboards ===
Contributors: strgl
Tags: storyboard, video, shotlist, production
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 8.0
Stable tag: 1.0.27
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

= 1.0.27 =
* Board back button always returns to the boards overview

= 1.0.26 =
* Remove admin setting; public boards controlled only via frontend toggle

= 1.0.25 =
* Public board control is a header toggle next to Delete

= 1.0.24 =
* Optional public read-only board links (Settings → Storyboards)

= 1.0.23 =
* Block video uploads; storyboard photos are JPEG/PNG/WebP only

= 1.0.22 =
* Scene photos: pick from WP media library; camera capture on mobile

= 1.0.21 =
* Remove leftover New board FAB styles and bottom spacing

= 1.0.20 =
* Boards overview: New board as plus tile in the grid

= 1.0.19 =
* Always noindex /storyboards/; board URLs use the board name slug

= 1.0.18 =
* Add scene is a tile with plus icon instead of a FAB

= 1.0.17 =
* Desktop: click outside modal closes it; cancel buttons removed from sheets

= 1.0.16 =
* Scene photo full-width in modal; change/remove as icon actions

= 1.0.15 =
* Scene title is edited in the modal heading; separate title field removed

= 1.0.14 =
* Scene modal: small input text, wider Duration, more vertical padding

= 1.0.13 =
* Scene overview descriptions use theme small font size

= 1.0.12 =
* Scene titles use h4

= 1.0.11 =
* 6px radius on inputs, images, and grid tiles

= 1.0.10 =
* Swipe or tap to move between scenes in the editor; clearer text field surfaces

= 1.0.9 =
* Fix serif fallback: stop overriding theme body font with inherit

= 1.0.8 =
* Inherit theme typography; remove boxed/colored form chrome

= 1.0.7 =
* Cleaner UI with less rounding; editors as full-height right sidecar

= 1.0.6 =
* Board overview as aspect-ratio tiles; delete removed from overview

= 1.0.5 =
* Light theme-aware UI; scene tiles in a wide grid (image top, badges on image)

= 1.0.4 =
* Board overview shows scene count and total duration per board

= 1.0.3 =
* Board delete requires typing a random 4-digit code (fixes accidental one-tap delete)

= 1.0.2 =
* Clear in-app confirmation before deleting a storyboard (title + scene count warning)

= 1.0.1 =
* Prevent accidental loss of unsaved board/scene drafts (no overlay dismiss, confirm discard, keep form state across photo pick, handle browser back)

= 1.0.0 =
* Initial free MVP: boards, scenes, client WebP compression, list/timeline views, premium stubs
