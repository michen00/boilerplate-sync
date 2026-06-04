# Security Policy

## Supported Versions

Only the latest `v1.x` release receives fixes. The `v1` tag always points at
the latest release in that line.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/michen00/boilerplate-sync/security/advisories/new).
Please do not open public issues for security reports.

This is a personal project maintained on a best-effort basis. Reports are
typically acknowledged within a week; fixes ship as patch releases on the
`v1` line.

## Consumer Guidance

- Pin the action to a full commit SHA if your threat model includes
  compromise of this repository; the `v1` alias is movable by design.
- Release tags (`v*`) are signed and protected by a tag ruleset: only the
  repository owner can create, move, or delete them.
- Treat the repositories you sync **from** as part of your supply chain —
  see the [Important Warning](README.md#%EF%B8%8F-important-warning) section
  of the README.
