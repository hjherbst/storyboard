<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Deploy (required for user-visible changes)

The user wants a dead-simple test loop: change → publish → open the live app.

After any user-facing change (UI, API behavior, image upload, etc.):

1. Commit and push the branch.
2. Start the app locally (`env -u DATABASE_URL npm run dev`) if it is not already running.
3. Call `publish-app` with `project_dir: "."`, `suggested_slug: "storyboard"`, and the local `preview_url`.
4. Tell the user in one short German sentence: confirm **Publish** in the chat (first time), then open the app from the app pill to see the change.

Do not stop at screenshots or PR-only demos when the user wants to test. The published Cursor app is how they verify changes.

If the user says only "publish", "deploy", or "ich sehe die Änderungen nicht": republish the current tree immediately; do not invent a second hosting stack.
