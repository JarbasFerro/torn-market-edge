# Contributing

Bug reports, DOM compatibility fixes and carefully scoped improvements are welcome.

## Non-negotiable project constraints

Torn Market Edge must remain decision-support software. Contributions must not add:

- automatic buying;
- automatic selling;
- automatic bidding;
- automatic form submission;
- simulated clicks for game actions;
- CAPTCHA interaction;
- hidden/background Torn page requests;
- unattended trading automation;
- credential collection or transmission to third parties.

Official Torn API calls are allowed when they are needed for the feature and remain within a conservative request budget.

## Bug reports

Please provide:

- script version;
- Torn page/surface;
- exact item/category if relevant;
- browser and version;
- device/OS;
- userscript manager and version;
- steps to reproduce;
- expected result;
- actual result;
- screenshot when useful.

Remove or blur private information. Never include an API key.

## Development principles

- Prefer defensive DOM selectors over fragile hashed class names.
- Treat Torn as an SPA: page content may change without a full navigation.
- Do not let Market Edge DOM changes trigger endless observer loops.
- Prefer incremental row updates over rebuilding whole overlays.
- Use integer dollar amounts for money calculations wherever possible.
- Keep economic calculations in pure functions when practical.
- Do not use the current lowest listing as fair value.
- Distinguish facts, local observations, estimates and model classifications.
- Avoid false precision.
- Preserve mobile usability.
- No external executable dependencies unless there is a strong reason and Greasy Fork rules are satisfied.

## Before submitting a change

Run `npm ci && npm run check`, then the manual checks in [docs/TESTING.md](docs/TESTING.md). jsdom is the only development dependency and is never shipped in the userscript. When you touch a page collector, update the HTML fixture in `tests/fixtures/` that covers it.

For a public release, also follow [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md).
