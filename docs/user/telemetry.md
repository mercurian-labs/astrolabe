# Product usage data

Astrolabe doesn't collect product usage data. The server sends no usage events, so nothing about
your providers, models, turns or accounts leaves your machine for analytics.

A build can include relay connection traces, which are sent to Axiom to diagnose remote access
connections. They're off unless the build was configured with a trace destination.

To make sure relay tracing stays off, set `ASTROLABE_TELEMETRY_ENABLED=false` in the server's
environment before starting it. Relay tracing also stops when `ASTROLABE_OTEL_SDK_DISABLED` or
`OTEL_SDK_DISABLED` turns OpenTelemetry export off. The web app in a browser, including one the
`astrolabe` CLI opens, does not read these variables.

The desktop app reads `ASTROLABE_TELEMETRY_ENABLED` from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`ASTROLABE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `ASTROLABE_OTLP_*_URL`, set `ASTROLABE_OTLP_HEADERS` for
receivers that need authentication and `ASTROLABE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
