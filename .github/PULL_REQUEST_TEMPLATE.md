<!-- Keep it short. A reviewer should understand the change in under a minute. -->

## What this changes

<!-- One paragraph. What behaviour is different after this pull request? -->

## Why

<!-- The problem it solves. Link the issue if there is one: "Fixes #12". -->

## How it was verified

- [ ] `npm test` passes
- [ ] `npm run e2e` passes
- [ ] `npm run build` passes

If the change affects the page turn, attach frames from `tools/frames.mjs` at the
same progress value before and after:

| Progress | Before | After |
| --- | --- | --- |
| | | |

## Checklist

- [ ] One concern per pull request
- [ ] New behaviour in `src/curl.js`, `src/book.js` or `src/page-cache.js` comes
      with a test that failed before the change
- [ ] No new runtime dependency
- [ ] `CHANGELOG.md` updated under Unreleased, if the public surface changed
- [ ] No copied code from a commercial product
- [ ] The honest limitations in the README are still accurate

## Anything a reviewer should be suspicious of

<!-- The part you are least sure about. Naming it saves a review round. -->
