# Security Policy

## Supported Versions

Currently, only the latest release of Nexus Echo (v2.x) is actively supported with security updates.

## Reporting a Vulnerability

If you discover a security vulnerability within Nexus Echo, please send an e-mail to the maintainer. All security vulnerabilities will be promptly addressed. 

## Resolving Vulnerabilities (For Developers)

If you find vulnerabilities during development or via automated scanning tools, here are the steps to resolve them:

### 1. Node.js / Front-end Dependencies (pnpm)

The front-end and some tooling rely on npm packages. To audit and fix these:

1. **Audit dependencies:**
   Run the following command in the root directory:
   ```bash
   pnpm audit
   ```
2. **Fix vulnerabilities automatically:**
   If there are fixable vulnerabilities, you can run:
   ```bash
   pnpm audit --fix
   ```
   Or update specific packages:
   ```bash
   pnpm update <package-name>@latest
   ```
3. **Manual resolution:**
   Sometimes `pnpm` cannot automatically fix transitive dependencies. In such cases, use the `pnpm.overrides` field in your `package.json` to force a secure version of the vulnerable package.

### 2. Rust / Back-end Dependencies (Cargo)

The back-end (Tauri) relies on Rust crates. To audit and fix these:

1. **Install cargo-audit (if not installed):**
   ```bash
   cargo install cargo-audit
   ```
2. **Audit dependencies:**
   Navigate to the `apps/desktop/src-tauri` directory and run:
   ```bash
   cargo audit
   ```
3. **Fix vulnerabilities:**
   Update the vulnerable crates by modifying your `Cargo.toml` to require a patched version, or simply run:
   ```bash
   cargo update -p <crate-name>
   ```
   This will update the `Cargo.lock` file with the latest compatible and secure version of the crate.

### 3. Tauri Security Best Practices

When resolving architectural vulnerabilities, ensure you adhere to Tauri's security guidelines:
- **IPC Validation:** Always validate payloads received from the front-end in `src-tauri/src/commands.rs`. Use strict Zod parsing on the front-end and corresponding typed structs in Rust.
- **CSP (Content Security Policy):** Maintain a strict CSP in `tauri.conf.json` to prevent XSS attacks.
- **Scope Restriction:** Ensure `tauri-plugin-fs` and `tauri-plugin-dialog` scopes are restricted to only necessary directories if applicable.
