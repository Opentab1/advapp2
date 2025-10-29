# ⚡ Quick Start Guide

Get Pulse Dashboard running in 5 minutes!

## 🚀 Installation

```bash
# 1. Install dependencies
npm install

# 2. Start development server
npm run dev
```

Open `http://localhost:5173` and you're ready to go! 🎉

## 🔑 Demo Mode

The app runs in **demo mode** by default:
- Any email/password combination works for login
- Mock data is displayed
- All features are fully functional

## 📱 Test PWA Features

### Desktop
1. Look for the install icon (⊕) in the browser address bar
2. Click to install as desktop app

### Mobile
1. Open in mobile browser (Chrome/Safari)
2. Tap browser menu
3. Select "Add to Home Screen"

## 🎨 Explore Features

### Live Monitoring
- View real-time metrics (updates every 15s)
- See comfort level gauge (0-100 score)
- Monitor sound, light, temperature, humidity

### Historical Data
- Click different time ranges (6h, 24h, 7d, 30d, 90d)
- Zoom into charts (scroll wheel)
- Pan charts (click and drag)

### Export Data
- Click "Export" button
- Download CSV with all data points
- Or press **E** key

### Keyboard Shortcuts
- **R** - Refresh data
- **E** - Export CSV

## 🔧 Connect to Real API

1. **Update `.env` file:**
```env
VITE_COGNITO_USER_POOL_ID=your_actual_pool_id
VITE_COGNITO_CLIENT_ID=your_actual_client_id
VITE_API_BASE_URL=https://your-api-url.com
```

2. **Restart dev server:**
```bash
npm run dev
```

3. **Login with real credentials**

## 📦 Build for Production

```bash
# Create optimized build
npm run build

# Preview production build
npm run preview

# Deploy (see README for full instructions)
```

## 🎯 Next Steps

### For Development
- Read `CONTRIBUTING.md` for code guidelines
- Check `README.md` for full documentation
- Review components in `src/components/`

### For Deployment
- Follow `DEPLOYMENT_CHECKLIST.md`
- Set up AWS Cognito (see README)
- Deploy to AWS Amplify

### For Mobile Apps
- Install Capacitor platforms
- Build iOS/Android apps
- See README "Mobile App" section

## 📚 Documentation

- **README.md** - Complete documentation
- **DEPLOYMENT_CHECKLIST.md** - Pre-deploy checklist
- **CONTRIBUTING.md** - Contribution guidelines
- **public/ASSETS_README.md** - PWA icon guide

## 🆘 Troubleshooting

### Port already in use
```bash
# Kill process on port 5173
npx kill-port 5173

# Or use different port
npm run dev -- --port 3000
```

### Dependencies not installing
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Build errors
```bash
# Check Node version (needs 18+)
node --version

# Update dependencies
npm update
```

## ✨ Key Features to Try

1. **Login** - Try any credentials (demo mode)
2. **Live View** - See real-time updates
3. **Time Ranges** - Switch between 6h, 24h, 7d, etc.
4. **Charts** - Zoom and pan on any chart
5. **Export** - Download data as CSV
6. **Install PWA** - Add to home screen
7. **Offline Mode** - Disconnect internet to test

## 🎨 Customize

### Change Colors
Edit `tailwind.config.js`:
```js
colors: {
  navy: '#YOUR_COLOR',
  cyan: '#YOUR_COLOR'
}
```

### Modify Comfort Formula
Edit `src/utils/comfort.ts`

### Adjust Refresh Interval
Edit `src/hooks/useRealTimeData.ts` (default: 15000ms)

## 💡 Tips

- Check browser console for logs
- Use React DevTools for debugging
- Test in Incognito mode for PWA
- Use mobile device for best PWA experience

---

**Need help?** Check README.md or open a GitHub issue!

Happy coding! 🚀
