This release adds a Traditional Chinese UI and lets each model slot of a subscription switch to a different model by weekday and time of day; it also adds a "Check for updates automatically" switch. Note: subscriptions with an empty model slot are no longer called after upgrading; see "Other".

## Features
- **Traditional Chinese UI**: Pick "繁體中文" under Settings → General → UI language. Wording follows Taiwan usage and is shared with Hong Kong and Macau.
  - Covers the desktop UI, web UI, terminal UI, tray menu, provider names and descriptions, and these release notes.
  - With "Follow system", Traditional Chinese (Taiwan / Hong Kong / Macau) and Cantonese systems show 繁體中文; other Chinese systems still show 简体中文.
  - Chinese and Japanese fonts now follow the UI language, so Traditional Chinese and Japanese no longer render with Simplified Chinese glyphs.
- **Switch a model slot's model by time of day** (#62, thanks @WayneOffice for the suggestion): Useful when one subscription offers discounts on different models during the day and at night. Set it up in the "Model slots" card on the subscription edit page.
  - Each slot has a default model plus up to 16 ordered time rules: pick the days (Every day / Weekdays / Weekend / Custom), a start and end time (on the hour or half hour, may cross midnight) and a model. Earlier rules take priority.
  - Each time rule can set its own thinking effort; "Same as slot" uses the effort set next to the default model.
  - The default model can be "None (unavailable outside rules)": outside the rules, this subscription is left out of that slot's routing, and requests go to the other subscriptions bound to the virtual model.
  - A live weekly preview on the right flags rules fully hidden by earlier ones and slots that are never available. "Copy to other slots" copies the current slot's schedule to the other three.
  - Times follow the clock of the computer running cc-router and are evaluated when each request arrives; saved settings are never rewritten.
  - The Virtual models page is now a route map: each virtual model expands into its subscriptions and then each time rule, with the row that matches right now marked. Drag "View time" at the top to any half hour in the week to see how requests would be routed then; time ranges in the week with no usable subscription are shown in red.
  - The Subscriptions page in the terminal UI shows the model each slot uses right now, and slots with time rules carry a "Timed" badge.
  - Test connection uses the model and thinking effort in effect right now.
- **Check for updates automatically switch** (on by default): Settings → General → App updates → Check for updates automatically; the Updates page has the same switch. When off, cc-router no longer checks for a new version at launch and only goes online when you check manually.

## Fixes
- **Test connection failures showed no result** (#63): When the upstream returned an empty error body, the UI used to show only a "Test model" line. Failures now always show a "Connection failed" title and the reason, such as "HTTP 401" plus the first 300 characters of the upstream error.
- **The launch-time update check on Linux deb ignored the "Update source" setting**: It used to run before settings loaded and always queried the global source; it now uses the source you picked.

## Other
- **Subscriptions with an empty model slot are no longer called**: Previously an empty slot sent requests upstream with an empty model name, which local services such as llama.cpp accepted. Now a subscription whose slot has no model at the moment is skipped and other subscriptions handle the request; if none is usable, a 503 explains why. Fill in any model name for that slot to get the old behavior back.
- **Subscription edit page layout**:
  - "Usage quota" settings and usage progress are merged into one card, with one row per period: the limit, a usage bar and the reset time. Periods without a limit also show how much has been used.
  - "Balance" no longer has its own card; it sits to the right of "Basic info" and moves below the fields when the window is narrow.
- **README is now available in Traditional Chinese**.
- **Dependency upgrades for security alerts**: They concern the development server and indirect dependencies; there is no exploitable path in the installed app.
