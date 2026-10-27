# Remote access troubleshooting

> **Not available yet.** Remote access through your Astrolabe account isn't live,
> so this guide applies only once it is. See [Remote access](./remote-access.md)
> for direct pairing.

A remote access connection goes through four parts, in this order:

1. **This device** reaches the remote access service over the internet.
2. **Remote access** checks your sign-in and the host's link.
3. **The host's tunnel** (cloudflared on the host) carries the request to the host.
4. **T3 Code on the host** answers.

When a connection fails, open **Settings > Environments**, find the environment,
and select **Details**. The first part marked as failed is the cause. Find its
section below.

To see the host's side, run `astrolabe connect status` on the host, or open
**Settings > Sharing & access** on the host. Both check the host's remote access
address from the host, and say why it fails. `astrolabe connect` runs the same check
when it finishes setup. This check cannot test another device's network. For a
problem on one device, use **Details** on that device.

## The host's tunnel is offline

Remote access could not reach the host's tunnel. This means one of these:

- The host is asleep, turned off, or offline.
- T3 Code is not running on the host.
- The host's network blocks the tunnel. See
  [Port 7844 is blocked on the host](#port-7844-is-blocked-on-the-host).

Fix:

1. Make sure the host is awake and T3 Code runs on it.
2. On the host, run `astrolabe connect status`. It names the problem on the host's side.
3. If the host was offline for a long time, remote access removes its tunnel. Start
   T3 Code on the host and update it to the latest version. It gets a new tunnel.

## Port 7844 is blocked on the host

The tunnel on the host connects out to Cloudflare on port 7844, with TCP and
UDP. Both tunnel protocols (QUIC and HTTP/2) use this port. When the host's
network blocks it, the tunnel cannot start, but normal web traffic still works.
The host looks online, so this problem is easy to miss.

Common causes:

- **A Tailscale exit node on the host.** All of the host's internet traffic goes
  through the exit node, and that network blocks port 7844. Turn off the exit
  node on the host with `tailscale set --exit-node=`, or allow outbound port
  7844 on the exit node's network.
- **A VPN on the host.** Work VPNs often block unknown ports. Ask for port 7844
  to be allowed, or use a direct route instead (see below).
- **A firewall or strict network.** Allow outbound TCP and UDP port 7844.

If you cannot unblock the port, you can connect without remote access. When the
host and this device are on the same Tailscale network, add the host's
Tailscale address as a direct route. See
[Reach one machine several ways](./remote-access.md#reach-one-machine-several-ways).

## The tunnel works, but T3 Code does not answer

The host's tunnel is up, but it cannot reach T3 Code on the host. Common causes:

- T3 Code on the host stopped, crashed, or is still starting.
- T3 Code restarted on a different port, for example after an update, and the
  tunnel still points at the old port.
- The server binds only one network address with `ASTROLABE_HOST`. The tunnel
  sends requests to `127.0.0.1`, so the server must also listen there.

Fix: restart T3 Code on the host. For the background service, run
`astrolabe service restart`. Then run `astrolabe connect status` on the host.

## The T3 Connect address does not resolve or answer

The host's remote access address did not resolve, refused the connection, failed a
secure (TLS) connection, or did not answer in time.

Fix:

1. Make sure the host is awake and online.
2. On the host, run `astrolabe connect status`.
3. If the check fails only on the host, check the host's DNS, VPN, or proxy.

## This device can't reach T3 Connect

The problem is on this device's network, not on the host. This device could
not reach the remote access service, or it reached the service but not the
host's tunnel address.

Fix:

1. Check this device's internet connection. On a captive or dead Wi-Fi network,
   the device can look online but cannot reach anything.
2. A VPN, firewall, ad blocker, or DNS filter on this device can block
   remote access. Turn it off for a moment to test.
3. On iPhone, Connectivity Assist in the Wi-Fi settings can break remote access.
   Turn it off to test.
4. Try another network, or add a direct route to the host, such as its
   Tailscale address. See
   [Reach one machine several ways](./remote-access.md#reach-one-machine-several-ways).

## Sign-in, account, or link problems

Remote access does not have an active link between your Astrolabe account and
the host.

- **The host is linked to a different account.** Sign in to the same Astrolabe
  account on this device and on the host. On the host, run `astrolabe connect logout`,
  then `astrolabe connect`.
- **Remote access is off on the host, or the host only publishes agent activity.**
  On the host, open **Settings > Sharing & access** and turn **Remote access** on, or
  run `astrolabe connect`.
- **The host was linked, but the server did not apply the link yet.** Run
  `astrolabe service restart` on the host, or restart `astrolabe serve`.
- **This device's sign-in expired, or the host no longer accepts this
  device.** Sign out of your Astrolabe account and sign in again.
- **Your account reached its tunnel limit.** Remove an environment you do not
  use from your account menu's **Remote access** page, then restart T3 Code on the host.

## The clock is off

Remote access signs requests with short-lived proofs and rejects them when the
clock on this device or the host is a few minutes wrong. Turn on
automatic date and time on both devices, then retry.

## The host runs an older T3 Code

This app needs a newer T3 Code on the host. Update T3 Code on the host. See
[Updating T3 Code](./updating.md).

## T3 Connect returned an error

| Error                                                     | Fix                                                                                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` or managed tunnel limit | Remove an unused environment, then restart T3 Code on the host.                                                                                                  |
| `auth_invalid` or `invalid_bearer`                        | Run `astrolabe connect login`. If credentials were revoked, run `astrolabe connect logout`, then `astrolabe connect` again. Restart the server after signing in. |
| Expired or invalid link proof                             | Check the host's date and time, update T3 Code, then restart it.                                                                                                 |
| HTTP 403 without a recognized error                       | Check relay access, proxies, and firewall rules. Keep any Cloudflare Ray ID for a bug report.                                                                    |
| HTTP 408, 429, or 5xx                                     | Wait a few minutes. T3 Code retries temporary failures on its own.                                                                                               |

After you fix a permanent rejection, restart the host's server with
`astrolabe service restart`. For a foreground server, stop it and run `astrolabe serve` again.

If T3 Code on the host disappears when SSH closes, see
[background-service troubleshooting](./background-service.md#troubleshooting).

## Report a problem

If none of this helps, report it to the Astrolabe team. Include:

- The text from **Copy diagnostics** in the environment's **Details**.
- The output of `astrolabe connect status` on the host.
- The trace ID, if one is shown.
