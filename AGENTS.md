# Release handoff

- After changing the codebase, prepare a release with a new version tag and include copyable PowerShell commands in the final response.
- Check existing versions and tags, choose the next unused version, and keep package.json and package-lock.json in sync.
- Include commands to stage the relevant files, commit, tag, and push the commit and tag to GitHub. The release workflow runs when a `v*` tag is pushed.
- Leave committing, tagging, and pushing to the user unless they explicitly ask you to run them.
- Do not append model, usage, cost, or other telemetry footers to chat responses; use the native terminal statusline.
