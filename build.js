// Builds public/app.js from src/app.js for older phones (iOS Safari 12.2+ / old Android Chrome).
// Runs automatically after `npm install` (postinstall), so Render builds it on every deploy.
const esbuild = require('esbuild');
esbuild.buildSync({ entryPoints: ['src/app.js'], outfile: 'public/app.js', target: ['es2019', 'safari12'], supported: { destructuring: true }, legalComments: 'none', logLevel: 'info' });
