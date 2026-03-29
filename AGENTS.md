<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

Before committing any changes, do following:
- Build project (success)
- Run all tests (all pass)
- Build docker image (success)
- Run app in docker and test with both db type (sqlite and postgres)
- Also make sure coolify compatibility (Coolify changes container names - adds random string after preconfigured names.)