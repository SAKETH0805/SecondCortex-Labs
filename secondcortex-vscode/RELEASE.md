# SecondCortex VS Code Extension Release Guide

This guide is for publishing `secondcortex` to the VS Code Marketplace.

## Prerequisites (One-Time)

1. Create a publisher at: `https://marketplace.visualstudio.com/manage`
2. Ensure publisher ID matches `package.json`:
- `publisher`: `secondcortex-labs`
3. Install VSCE globally (optional, scripts use `npx`):
```powershell
npm install -g @vscode/vsce
```
4. Create Azure DevOps PAT with Marketplace scope:
- Scope required: `Marketplace (Manage)`

## One-Time Login

```powershell
cd "c:\Users\SUHAAN\Desktop\SecondCortex Labs\code\secondcortex-vscode"
vsce login secondcortex-labs
```

When prompted, paste your PAT.

## Preflight Checks

```powershell
npm run compile
npm run vsix
```

If successful, VSIX is created in this folder as `secondcortex-<version>.vsix`.

## Publish Commands

Use one of:

```powershell
npm run publish:patch
npm run publish:minor
npm run publish:major
```

- `patch`: bugfix UI/logic updates
- `minor`: new features
- `major`: breaking changes

## Manual Version Publish (Alternative)

If you want explicit manual versioning in `package.json`:

```powershell
npm version 0.1.6 --no-git-tag-version
npx @vscode/vsce publish --allow-star-activation
```

## Local Install Test

```powershell
code --install-extension ".\secondcortex-<version>.vsix" --force
```

Then run VS Code command: `Developer: Reload Window`.

## Troubleshooting

- `403` or auth errors:
  - PAT scope is wrong or expired.
  - Run `vsce login secondcortex-labs` again.
- Publish says version already exists:
  - Bump version and retry.
- Installed extension looks unchanged:
  - Ensure version changed.
  - Reinstall with `--force`.
  - Reload window.

## Current Build Notes

- Build output is `out/` (required for marketplace package entry `main: ./out/extension.js`).
- Packaging currently uses `--allow-star-activation` because `activationEvents` includes `*`.
