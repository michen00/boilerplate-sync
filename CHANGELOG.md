<!-- markdownlint-configure-file { "no-duplicate-heading": false, "ul-style": false, "no-multiple-blanks": false } -->

# Changelog

All notable changes will be documented in this file. See [conventional commits](https://www.conventionalcommits.org) for commit guidelines.

The format is based on [Keep a Changelog](https://keepachangelog.com) and this project adheres to [Semantic Versioning](https://semver.org).

## [1.0.4](https://github.com/michen00/boilerplate-sync/compare/v1.0.3...v1.0.4) (2026-06-10)

### Bug Fixes

- **sync:** reject globs in file_pairs sources ([#120](https://github.com/michen00/boilerplate-sync/issues/120)) ([8d0f88d](https://github.com/michen00/boilerplate-sync/commit/8d0f88d0b39b66b59500e14a3ef9f24268695a27))

## [1.0.1](https://github.com/michen00/boilerplate-sync/compare/v1.0.0...v1.0.1) (2026-06-09)

### Features

- **ci:** push dist commits via GitHub App token ([#96](https://github.com/michen00/boilerplate-sync/issues/96)) ([64750e0](https://github.com/michen00/boilerplate-sync/commit/64750e0e550788d1b4b59d8db80836140b41e645))

### Bug Fixes

- resolve post-merge review findings ([#109](https://github.com/michen00/boilerplate-sync/issues/109)) ([683564f](https://github.com/michen00/boilerplate-sync/commit/683564ff069e2f7b8d0434a151c3262ec69a0128))
- sweep unresolved review threads from #64-#96 ([#97](https://github.com/michen00/boilerplate-sync/issues/97)) ([9f7f96d](https://github.com/michen00/boilerplate-sync/commit/9f7f96d4244e4883ff4caf741b6e045bb9f55ed3))

## 1.0.0 (2026-06-04)

### ⚠ BREAKING CHANGES

- remove PR functions
- remove unused config
- simplify config

### Features

- add boilerplate ([02052a8](https://github.com/michen00/boilerplate-sync/commit/02052a800e1ad805bd986c0150d0919d41aec327))
- add glob pattern support for default_files ([c9359cd](https://github.com/michen00/boilerplate-sync/commit/c9359cd89d4bc296377815723c97b16374f07182))
- implement boilerplate-sync GitHub Action ([1ce78a6](https://github.com/michen00/boilerplate-sync/commit/1ce78a639458ca47e78eaf18755a93a616167a10))
- remove PR functions ([628239d](https://github.com/michen00/boilerplate-sync/commit/628239d6fe263590165b14e8fc66b6e78c8e19f4))
- remove unused config ([9a32aed](https://github.com/michen00/boilerplate-sync/commit/9a32aede9fb969fdac3ab165c48cfa661fc151cc))
- simplify config ([ec19e37](https://github.com/michen00/boilerplate-sync/commit/ec19e3794466d2b09949049b972cb63cb7501d58))
- supersede pending PRs ([#64](https://github.com/michen00/boilerplate-sync/issues/64)) ([d54489b](https://github.com/michen00/boilerplate-sync/commit/d54489b99eb0b0d9442aaaae1fa299bdd30485e4))

### Bug Fixes

- add missing composite ([de0b167](https://github.com/michen00/boilerplate-sync/commit/de0b1673b9c46e5c233c1c2a8a4e31ee16b98f25))
- **action.yml:** escape the dollar sign ([9e27ec9](https://github.com/michen00/boilerplate-sync/commit/9e27ec97afeb16eee93926fefebc1aca32aebcfa))
- **ci:** repair bot-automerge dist commit flow ([#92](https://github.com/michen00/boilerplate-sync/issues/92)) ([9e29a74](https://github.com/michen00/boilerplate-sync/commit/9e29a74ee26b003e0efe02ba0154f280bfe6c817))
- **ci:** tolerate check-run lag after CI dispatch ([#94](https://github.com/michen00/boilerplate-sync/issues/94)) ([e644bad](https://github.com/michen00/boilerplate-sync/commit/e644bad4059d0ceb22cef24d5e1d616ebf0b714a))
