# Performance gate states

The CI performance job reports one of four explicit states in the GitHub step summary:

- `ADVISORY PASS`: a pull-request run measured the currently deployed site and the budgets passed. This does not validate the PR code.
- `ADVISORY FAIL`: a pull-request run measured the currently deployed site and at least one budget failed. This is visible but does not block the PR.
- `BLOCKING PASS`: a fresh manual `workflow_dispatch` run after deployment measured production and all budgets passed.
- `BLOCKING FAIL`: a fresh manual `workflow_dispatch` run after deployment measured production and at least one budget failed.

Only `BLOCKING PASS` counts as final post-deploy performance verification.
