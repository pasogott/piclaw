# Planned UX contracts

This root is reserved for desired, unimplemented contracts tagged `@planned @not-implemented`.

- [Single-user passkey Settings](single-user-passkey-settings.feature) — add, name and remove several credentials in both skins; proposed recent-authentication, lockout and session policies are tagged separately. [Design and validation plan](../../../../docs/design/single-user-passkey-settings.md).

The SVG-image cases introduced by #1324 have moved, without duplicate IDs, to [shared/svg-images.feature](../shared/svg-images.feature). #1325 implements them in both skins and supplies Chromium/WebKit assertions. Import shared acceptance with either skin root; do not treat future planned contracts as passing implementations.
