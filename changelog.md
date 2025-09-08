# Changelog

## [Unreleased]

### Added

- Smarter Value Set loading from loaded/cached value sets

### Fixed

- Field-definition lookups sometimes found matching fields, resulting in checking things like `cda:code` rather than `@code`

## [1.1.0] - 2024-10-25

Primary goal was to enable schematron generation automatically via the IG publisher.

### Added

- Ability to set `value-set-limit` and `parent-template-id` parameters via ImplementationGuide resource params
- Pass `.` as ig to run against ig in the current directory

## [1.0.2] - 2024-09-24
Initial released version of converter, published to npm.
