/**
 * ╔══════════════════════════════════════════════════════╗
 * ║  config.js — PRIVATE — never commit this file        ║
 * ║  This file is listed in .gitignore so GitHub will    ║
 * ║  never see it. Fill in your real values below.       ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * HOW TO USE:
 *  1. Fill in your values below
 *  2. Keep this file only on your local machine
 *  3. The app reads these values at startup
 *  4. GitHub Pages serves app.js but NOT this file
 *     (because it's in .gitignore)
 *
 * ⚠ WARNING: If you ever accidentally push this file,
 *   immediately revoke the token at github.com/settings/tokens
 */

window.__FLOWBOARD_CONFIG__ = {
  // Your GitHub username (e.g. 'johndoe')
  owner: 'YOUR_GITHUB_USERNAME',

  // The repo name where tickets.json/csv will be saved (e.g. 'my-kanban')
  repo: 'YOUR_REPO_NAME',

  // Branch to save files to (almost always 'main')
  branch: 'main',

  // Fine-grained PAT — needs Contents: Read & write on your repo
  // Create one at: https://github.com/settings/tokens?type=beta
  token: 'YOUR_GITHUB_PAT',

  // Password users must enter to edit the board
  // Viewers who don't know this see it as read-only
  password: 'YOUR_BOARD_PASSWORD',
};
