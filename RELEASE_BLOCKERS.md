# RELEASE_BLOCKERS.md

> [!CAUTION]
> **RELEASE BLOCKED — source and visual gaps also remain.** A passing CI job and a generated unsigned installer do not prove release readiness. Historical visual matrix screenshots captured Splash overlays. See [independent evidence corrections](docs/PRODUCTION_EVIDENCE_CORRECTIONS_2026-10-27.md).


**KNOUX REC — Release Blockers and External Requirements**

## Status: PRODUCTION BLOCKED (visual evidence + signing + release prerequisites)

Historical all-PASS certification is invalid; G11 visual evidence and G12 signing failed independent verification. The following items are **external requirements** that must be resolved before public release.

---

## External Blockers (Require User/Approval Action)

### B1: Authenticode Code Signing
- **Status**: NotSigned (neither installer nor unpacked executable has an Authenticode signer)
- **Requirement**: Purchase and configure a real Authenticode certificate
- **Impact**: Windows SmartScreen will warn users on unsigned installers
- **Action Required**: Procure certificate, configure in `electron-builder` signing pipeline
- **Owner**: Release engineering

### B2: Updater Policy
- **Status**: Not configured
- **Requirement**: Define update channel (stable/beta), rollback policy, and update server
- **Impact**: Users cannot receive automatic updates
- **Action Required**: Configure `electron-updater` with update server URL
- **Owner**: Release engineering

### B3: Privacy Policy Document
- **Status**: Not written
- **Requirement**: PRIVACY.md covering data collection, storage, and third-party services
- **Impact**: Required for store listings and GDPR compliance
- **Action Required**: Draft and review privacy policy
- **Owner**: Legal / product

### B4: License Decision
- **Status**: Undecided
- **Requirement**: Choose open-source license or proprietary terms
- **Impact**: Determines distribution model
- **Action Required**: Legal review and license selection
- **Owner**: Legal

### B5: Store Listing Assets
- **Status**: Not prepared
- **Requirement**: Screenshots, descriptions, keywords for Microsoft Store / Steam / direct download
- **Impact**: Cannot publish to stores without assets
- **Action Required**: Prepare marketing assets
- **Owner**: Marketing

---

## Non-Blocking (Known Limitations)

### L1: Chunk Size Warning
- **Issue**: Main JS bundle is 1.08 MB (gzip: 317 KB)
- **Impact**: Slightly slower initial load on slow connections
- **Mitigation**: Code splitting recommended but not blocking
- **Priority**: Low

### L2: 156 Failed Network Requests in UI Smoke
- **Issue**: Font fallback 404s during smoke test
- **Impact**: None — expected behavior for font subsetting
- **Priority**: Informational

---

## Blocker Resolution Checklist

- [ ] B1: Authenticode certificate procured and configured
- [ ] B2: Updater policy defined and implemented
- [ ] B3: Privacy policy drafted and reviewed
- [ ] B4: License decision made
- [ ] B5: Store listing assets prepared

**Do not claim a trusted public release until signing, functional and visual evidence, and policy gates have passed.**