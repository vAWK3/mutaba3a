# CHANGELOG.md — Change History

> **Purpose**: Track all significant changes to the codebase.
> **Rule**: Update this file after completing any change.

---

## Format

```markdown
## [Version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

### Technical
- Refactoring, dependencies, infrastructure
```

---

## [0.0.48] - 2026-02-09

### Added
- Created `.claude/SYSTEM_OVERVIEW.md` - comprehensive system documentation
- Created `.claude/DECISIONS.md` - architectural decision records
- Created `.claude/COMPONENT_REGISTRY.md` - reusable component catalog
- Created `.claude/PATTERNS.md` - code patterns and conventions
- Created `.claude/CHANGELOG.md` - this file
- Created `.claude/TECH_DEBT.md` - technical debt tracking
- Created `.claude/CI_CD.md` - CI/CD pipeline documentation
- Added h5, h6 heading styles to index.css for completeness

### Changed
- Updated `DECISIONS.md` ADR-018 with canonical token naming clarification
- Updated `PATTERNS.md` with Design Token Patterns section (token quick reference, button styling, focus styles, dark mode support)
- Updated `TECH_DEBT.md` with TD-011 for design system inconsistencies (now resolved)

### Fixed
- **Design System Unification (TD-011 - Resolved)**:
  - Phase 1: Added deprecation notices to legacy CSS variables in index.css
  - Phase 2: Removed dead `.landing-btn--*` classes from LandingPage.css, removed inline fallback values from 12 landing page CSS files
  - Phase 3: Migrated 39+ CSS files from legacy tokens to canonical tokens (`--font-size-*` → `--text-*`, `--font-weight-*` → `--weight-*`, `--shadow-sm/md/lg` → `--shadow-1/2/3`)
  - Phase 4: Standardized focus styles to use `box-shadow: var(--focus-ring)` instead of `outline` across 7 files; updated line-height to use `--leading-tight` (kept compact heading sizes for app UI)

### Technical
- Formalized project knowledge management system
- Design system now has single source of truth: `theme.css` for canonical tokens
- All focus-visible styles use `box-shadow: var(--focus-ring)` for consistency
- App headings use compact sizes (h1: 20px, h2: 18px, h3: 16px, h4: 14px) for data-dense cockpit UI
- Landing page headings use larger theme.css scale for marketing emphasis
- Fixed missed token migration in SplitWorkspace.css (`--shadow-lg` → `--shadow-3`)

---

## [0.0.47] - Previous

### Added
- Engagement letter feature (task/retainer types)
- PDF generation for engagement letters
- Profile-scoped engagements

### Changed
- Engagement schema to support profileId

---

## [0.0.46] - Previous

### Fixed
- Payment matching UI improvements
- Cache issues with service worker

---

## [0.0.44] - Previous

### Added
- Web release automation
- Service worker improvements

---

## [0.0.43] and Earlier

*Historical releases - see git log for details.*

---

## Migration Notes

### v0.0.48
- No database schema changes
- No breaking API changes

### v0.0.47
- Database schema v10: Added `profileId` to engagements table
- Migration: Existing engagements assigned to default profile

### v0.0.44
- Database schema v9: Added engagement tables

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 0.0.48 | 2026-02-09 | System documentation |
| 0.0.47 | 2026-02 | Engagement letters |
| 0.0.46 | 2026-01 | Payment UI fixes |
| 0.0.44 | 2026-01 | Web release |
| 0.0.40 | 2025-12 | Retainer matching |
| 0.0.35 | 2025-11 | Document immutability |
| 0.0.30 | 2025-10 | Expense tracking |
| 0.0.25 | 2025-09 | Document generation |
| 0.0.20 | 2025-08 | Sync foundation |
| 0.0.15 | 2025-07 | Multi-profile support |
| 0.0.10 | 2025-06 | Desktop (Tauri) |
| 0.0.5 | 2025-05 | Core MVP |
| 0.0.1 | 2025-04 | Initial release |
