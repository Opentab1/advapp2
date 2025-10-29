# 🚀 Deployment Checklist

Use this checklist before deploying to production.

## Pre-Deployment

### 1. Environment Variables
- [ ] Set up AWS Cognito User Pool
- [ ] Copy User Pool ID to `.env`
- [ ] Copy Client ID to `.env`
- [ ] Update API base URL in `.env`
- [ ] Test authentication flow locally

### 2. PWA Assets
- [ ] Add `pwa-192x192.png` to `/public`
- [ ] Add `pwa-512x512.png` to `/public`
- [ ] Add `favicon.ico` to `/public`
- [ ] Add `apple-touch-icon.png` to `/public`
- [ ] Verify all icons display correctly

### 3. Configuration Files
- [ ] Update `capacitor.config.ts` with correct app ID
- [ ] Update `public/manifest.json` with app name
- [ ] Verify `amplify.yml` build commands
- [ ] Check API endpoints in `api.service.ts`

### 4. Testing
- [ ] Test login with real credentials
- [ ] Test Google OAuth (if enabled)
- [ ] Verify real-time data updates
- [ ] Test all time ranges (6h, 24h, 7d, etc.)
- [ ] Test CSV export functionality
- [ ] Test on mobile devices
- [ ] Test PWA installation
- [ ] Test offline mode
- [ ] Verify keyboard shortcuts (R, E)

### 5. Code Quality
- [ ] Run `npm run build` successfully
- [ ] Check for console errors
- [ ] Remove debug logs
- [ ] Update README with production URLs
- [ ] Add proper error handling

## AWS Amplify Deployment

### 1. Setup Amplify
- [ ] Create new Amplify app
- [ ] Connect GitHub repository
- [ ] Verify `amplify.yml` is detected

### 2. Environment Variables
- [ ] Add `VITE_AWS_REGION` in Amplify Console
- [ ] Add `VITE_COGNITO_USER_POOL_ID`
- [ ] Add `VITE_COGNITO_CLIENT_ID`
- [ ] Add `VITE_API_BASE_URL`

### 3. Domain & SSL
- [ ] Configure custom domain (optional)
- [ ] Verify SSL certificate
- [ ] Update Cognito callback URLs with production domain

### 4. Deploy
- [ ] Push to main branch
- [ ] Monitor build logs
- [ ] Verify deployment success
- [ ] Test live site

## Post-Deployment

### 1. Verification
- [ ] Visit production URL
- [ ] Test login functionality
- [ ] Verify data loads correctly
- [ ] Test PWA installation
- [ ] Check mobile responsiveness
- [ ] Test all features end-to-end

### 2. Monitoring
- [ ] Set up CloudWatch (optional)
- [ ] Monitor API usage
- [ ] Check for errors in logs
- [ ] Monitor user authentication

### 3. Documentation
- [ ] Update README with production URL
- [ ] Document any custom configurations
- [ ] Add API documentation
- [ ] Create user guide (optional)

## Mobile App (Optional)

### iOS
- [ ] Add platforms: `npx cap add ios`
- [ ] Run: `npm run build && npx cap sync`
- [ ] Open Xcode: `npx cap open ios`
- [ ] Configure signing
- [ ] Update bundle ID
- [ ] Add app icons
- [ ] Test on device
- [ ] Submit to App Store

### Android
- [ ] Add platform: `npx cap add android`
- [ ] Run: `npm run build && npx cap sync`
- [ ] Open Android Studio: `npx cap open android`
- [ ] Update package name
- [ ] Add app icons
- [ ] Configure signing
- [ ] Test on device
- [ ] Submit to Play Store

## Security

- [ ] Enable HTTPS only
- [ ] Verify CORS settings
- [ ] Check authentication token expiry
- [ ] Review IAM permissions
- [ ] Enable rate limiting (API)
- [ ] Add CSP headers (optional)

## Performance

- [ ] Run Lighthouse audit
- [ ] Check bundle size
- [ ] Verify lazy loading
- [ ] Test loading times
- [ ] Optimize images
- [ ] Enable caching

## Rollback Plan

- [ ] Document rollback procedure
- [ ] Keep previous version available
- [ ] Test rollback process

---

✅ **All checks passed? You're ready to deploy!**
