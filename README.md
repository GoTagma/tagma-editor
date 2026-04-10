# tagma-editor

A visual editor for Tagma, built with React + Vite + Express.

## Requirements

- **Node.js** >= 22
- **npm** >= 11

Check your current versions:

```bash
node -v
npm -v
```

Upgrade npm if needed:

```bash
npm install -g npm@latest
```

## Getting Started

1. Install dependencies (prefer `npm ci` for a clean install that strictly follows `package-lock.json`):

   ```bash
   npm ci
   ```

   > On Windows you may hit `EPERM: operation not permitted, unlink ...esbuild.exe`. This usually means the file is locked by another process (a running dev server, your IDE, or antivirus). Close those processes, remove `node_modules`, and try again:
   >
   > ```bash
   > rmdir /s /q node_modules
   > npm ci
   > ```

2. Start the development environment (runs the Vite dev server and the Express backend in parallel):

   ```bash
   npm run dev
   ```

3. Build the production bundle:

   ```bash
   npm run build
   ```

4. Run the backend in production mode:

   ```bash
   npm start
   ```

5. Preview the built frontend locally:

   ```bash
   npm run preview
   ```

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run frontend and backend dev servers in parallel |
| `npm run dev:server` | Run backend only (`tsx watch server/index.ts`) |
| `npm run dev:client` | Run frontend only (`vite`) |
| `npm run build` | Build the frontend for production |
| `npm start` | Start the backend in production mode |
| `npm run preview` | Preview the production build locally |

## Notes

- Task positions are persisted to a sibling `.layout.json` file next to the YAML file, saved on `Ctrl+S`.
- Command-type task cards automatically hide AI-specific fields.
