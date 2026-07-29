Running build in Washington, D.C., USA (East) – iad1
Build machine configuration: 2 cores, 8 GB
Cloning github.com/acocciayan18/bugsafari (Branch: dev, Commit: 75a1d2f)
Previous build caches not available.
Cloning completed: 497.000ms
Running "vercel build"
Vercel CLI 56.5.0
Warning: Detected "engines": { "node": "^20.19.0 || >=22.12.0" } in your `package.json` that will automatically upgrade when a new major Node.js Version is released. Learn More: https://vercel.link/node-version
Running "install" command: `npm ci --include-workspace-root --workspace developer-dashboard --workspace shared`...
added 210 packages, and audited 213 packages in 9s
48 packages are looking for funding
  run `npm fund` for details
2 high severity vulnerabilities
To address all issues, run:
  npm audit fix
Run `npm audit` for details.
> bugsafaridashboard@1.0.0 build
> vite build
vite v8.1.3 building client environment for production...

transforming...✓ 1818 modules transformed.
✗ Build failed in 655ms
error during build:
Build failed with 2 errors:
[plugin vite:css] /vercel/path0/developer-dashboard/src/index.css
Failed to load PostCSS config: Failed to load PostCSS config (searchPath: /vercel/path0/developer-dashboard): [Error] Loading PostCSS Plugin failed: Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both package-lock.json and node_modules directory.
(@/vercel/path0/developer-dashboard/postcss.config.js)
Error: Loading PostCSS Plugin failed: Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both package-lock.json and node_modules directory.
(@/vercel/path0/developer-dashboard/postcss.config.js)
    at load (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:21063:10)
    at async Promise.all (index 0)
    at async plugins (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:21085:11)
    at async processResult (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:21123:13)
    at aggregateBindingErrorsIntoJsError (file:///vercel/path0/node_modules/rolldown/dist/shared/error-BlQ0-ek7.mjs:48:18)
    at unwrapBindingResult (file:///vercel/path0/node_modules/rolldown/dist/shared/error-BlQ0-ek7.mjs:18:128)
    at #build (file:///vercel/path0/node_modules/rolldown/dist/shared/rolldown-build-aV0QeeTW.mjs:3256:34)
    at async buildEnvironment (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:32622:66)
    at async Object.build (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:33044:19)
    at async Object.buildApp (file:///vercel/path0/node_modules/vite/dist/node/chunks/node.js:33041:153)
    at async CAC.<anonymous> (file:///vercel/path0/node_modules/vite/dist/node/cli.js:777:3) {
  errors: [Getter/Setter]
}
npm error Lifecycle script `build` failed with error:
npm error code 1
npm error path /vercel/path0/developer-dashboard
npm error workspace bugsafaridashboard@1.0.0
npm error location /vercel/path0/developer-dashboard
npm error command failed
npm error command sh -c vite build
Error: Command "npm run build --workspace developer-dashboard" exited with 1