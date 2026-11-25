# Product usage data

Astrolabe doesn't collect product usage data. The server sends no usage events, so nothing about
your providers, models, turns or accounts leaves your machine for analytics.

## Relay connection diagnostics

A build can include relay connection traces, which are sent to Axiom to diagnose remote access
connections. They're off unless the build was configured with a trace destination. Depending on
the client version, traces can include connection timings, environment identifiers and the
connected machine's name. Failed spans can include error messages and stack traces; error text can
quote a value the app was handling.

To make sure relay tracing stays off from the server, set `ASTROLABE_TELEMETRY_ENABLED=false` or
`DO_NOT_TRACK=1` in its environment before starting it. `DO_NOT_TRACK=1` wins over
`ASTROLABE_TELEMETRY_ENABLED=true`. Relay tracing also stops when `ASTROLABE_OTEL_SDK_DISABLED` or
`OTEL_SDK_DISABLED` turns OpenTelemetry export off.

On a CI runner, the server sends no relay traces by default. It treats a run as CI when a common CI
variable is set, such as `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, or `JENKINS_URL`. `CI=false` and
`CI=0` do not count. To send them from CI anyway, set `ASTROLABE_TELEMETRY_ENABLED=true`.

An administrator can turn relay tracing off in the server and desktop app with
a [managed policy](./managed-policy.md#other-capabilities). This does not control traces sent by
the hosted web app or mobile clients.

The desktop app reads `ASTROLABE_TELEMETRY_ENABLED` and `DO_NOT_TRACK` from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export them there and restart the app. On Windows, set them as user environment variables.

A browser opened from an Astrolabe server sends relay traces only while connected and allowed by
that server's policy. The hosted web app sends relay traces when configured and has no tracing
toggle.

## Mobile app diagnostics

The iOS and Android apps include crash reporting through the remote access relay, but Astrolabe's
builds ship with it switched off, so the apps send no crash reports.

The mobile app also sends relay connection traces when its build has tracing configured. These
carry an identifier for the current app session. To stop them, turn off **Send connection traces**
in **Settings > About Astrolabe > Diagnostics**, or on the remote access setup sheet shown after you
sign in. This is separate from crash reports. Server environment variables and managed policy do
not disable mobile tracing.

## Agent activity for mobile notifications

When **Publish agent activity** is enabled on a host, it sends project and thread titles, model
names, activity status, and environment and thread identifiers to the remote access relay for
[mobile notifications and live activities](./mobile-notifications.md). This is separate from
relay diagnostics. The telemetry opt-out does not disable it.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host. Turning off notifications on a phone controls that phone's alerts, not the host's
publishing setting.

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
