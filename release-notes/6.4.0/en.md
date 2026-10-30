This release adds a "Custom (System One decision model)" entry, so you can connect a Jev / Clef decision model endpoint in your LAN or from a third party to model-jev by hand; it also fixes long streaming generations being cut off at the 10-minute mark. Existing subscriptions behave the same after upgrading.

## Features
- **Custom System One decision model entry**: When adding a subscription, pick "Custom (System One decision model)" in the "Custom" group of the Provider dropdown and enter the Base URL, endpoint path, API key and Jev model by hand. It suits Ollama on another machine in your LAN, your own gateway, or another third-party host.
  - The subscription can only be bound to `model-jev`; requests are forwarded as-is, with no protocol translation.
  - Authentication can be `Authorization: Bearer` or `x-api-key`; if the upstream does not check API keys, enter any value.
  - The Jev model is required: a custom subscription has no example model to fall back on, so it cannot be saved empty or with only spaces, and cannot be cleared when editing. The Jev model of built-in System One subscriptions can still be left empty.
  - The terminal UI's new-subscription wizard supports it too; with this protocol the form has a single Jev model row.
  - For a `model-jev` request, a subscription with neither a Jev model nor an example model is skipped and the remaining subscriptions handle the request; if none is available the response is a 503 that states why, instead of the whole request failing with 400.

## Fixes
- **Long streaming generations cut off at 10 minutes** (#59, thanks @WayneOffice for the report): Requests forwarded upstream used to have a 600-second limit on total duration, so a streaming response that generated for more than 10 minutes was cut off midway. This is now an idle timeout: the connection is closed only after the upstream sends no data for 600 seconds in a row, so long generations that keep producing output are no longer limited. Non-streaming requests still wait up to 600 seconds.
  - The timeout error, previously "error decoding response body", now says that waiting for upstream data timed out and the connection was closed.
