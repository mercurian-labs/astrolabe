# Licensing

The Astrolabe app is open source under MIT. The code behind Mercurian's hosted service is public
too, under a source-available license that turns into MIT after two years. This page says which
license applies where. The license files are the binding text; if this summary and a license file
disagree, the license file wins.

## Which license covers what

| Directories                                                                                   | License                                                   |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `apps/cloud`, `apps/auth`, `apps/admin`, `infra/cloud`                                        | [FSL-1.1-MIT](apps/cloud/LICENSE), each its own `LICENSE` |
| Everything else: web, desktop, mobile, `apps/server` and the CLI, `packages/*`, `infra/relay` | [MIT](LICENSE)                                            |

A file's license is the license of the directory it lives in. Building or deploying the cloud
backend can pull MIT code in from elsewhere in the repository (the relay's migrations, shared
packages); that code stays MIT.

Third-party files keep their own licenses, wherever they sit. For example, the Fraunces font in
`apps/auth/src/assets/fonts` is under the SIL Open Font License (`OFL.txt` next to it), and the
vendored Ghostty code carries its own `LICENSE`.

## The app: MIT

The app is MIT licensed. You can use, copy, change, and redistribute it, commercially or not, as
long as you keep the copyright and license notice.

Most of the app is [T3 Code](https://github.com/pingdotgg/t3code), © T3 Tools Inc., also MIT. The
root `LICENSE` carries both copyright lines, Mercurian's and T3 Tools', and anything you
redistribute must keep both. The relay in `infra/relay` is upstream's.

## The cloud backend: FSL-1.1-MIT

The cloud backend (accounts and sign-in, teams and workspaces, the admin console, and the
infrastructure that deploys them) is under the
[Functional Source License, Version 1.1, MIT Future License](https://fsl.software/). The code is
public, and you can read, run, and change it, with one restriction for the first two years.

You can:

- use it inside your own company or organisation, including self-hosting it for your own team;
- use it for non-commercial education and research;
- use it to provide professional services to someone who is using it within these terms;
- change it and redistribute it for any of those purposes, keeping the license and copyright
  notices.

You can't offer it, or something built from it, to others as a commercial product or service that
competes with Astrolabe: one that substitutes for it, substitutes for another Mercurian product or
service that uses it, or offers the same or substantially similar functionality.

Two years after each version is first made available, that version is also available under MIT,
with no restriction. Newer versions follow on their own two-year clock.

## Names and logos

The license on the code does not cover Mercurian's names and logos. "Astrolabe", "Mercurian", and
their logos and wordmarks are trademarks, covered by the [trademark policy](TRADEMARKS.md). In
short: say truthfully that something works with Astrolabe, but give a fork or modified build its
own name and logo.

[DECISION: whether logo and wordmark files (`assets/`, `apps/web/src/assets/brand`,
`apps/web/public/brand`, `apps/mobile/src/components/brand`, `apps/auth/src/assets`) are excluded
from the MIT and FSL grants, or licensed with the code and protected only by the trademark policy]

## Contributing

Contributions to the MIT parts are accepted under MIT. See [CONTRIBUTING.md](CONTRIBUTING.md#licensing)
for the cloud directories.
