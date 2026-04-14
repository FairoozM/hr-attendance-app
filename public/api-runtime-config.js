/**
 * Optional production: Express API origin (no trailing slash), loaded before the app bundle.
 *
 * Preferred: set env **HR_PUBLIC_API_URL** when running `npm run deploy:frontend`; the deploy
 * script overwrites this file in `dist/` so all browsers use the API host (not CloudFront /api).
 *
 * Manual hotfix: uncomment and set, then upload `dist/api-runtime-config.js` next to index.html.
 *
 * Example:
 *   window.__HR_API_BASE_URL__ = 'https://your-alb-xx.region.elb.amazonaws.com'
 *   window.__HR_API_BASE_URL__ = 'https://api.yourdomain.com'
 *   window.__HR_API_BASE_URL__ = 'https://ec2-1-2-3-4.compute-1.amazonaws.com:5001'
 */
// window.__HR_API_BASE_URL__ = ''
