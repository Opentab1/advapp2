# 🌟 Pulse Dashboard - Futuristic IoT Monitoring PWA

A next-generation, ultra-professional Progressive Web App for real-time IoT monitoring. Built with cutting-edge technologies and featuring a stunning design inspired by Apple, Tesla, and Stripe.

![Tech Stack](https://img.shields.io/badge/React-18.2-61DAFB?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=for-the-badge&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?style=for-the-badge&logo=vite)
![Tailwind](https://img.shields.io/badge/Tailwind-3.4-06B6D4?style=for-the-badge&logo=tailwindcss)

## ✨ Features

### 🎨 Design System
- **Dark-mode first** with deep navy (#0a192f) and cyan glow (#00d4ff)
- **Glassmorphism cards** with backdrop blur and subtle glows
- **Micro-interactions** - Hover lifts, ripple effects, smooth animations
- **Animated background orbs** - Subtle floating gradients
- **Custom scrollbar** - Glowing cyan on hover
- **Inter font** with perfect kerning

### 📊 Real-Time Monitoring
- Live data polling every 15 seconds
- Real-time metrics: Decibels, Light, Temperature, Humidity
- **Comfort Level Gauge** - Intelligent 0-100 score with color coding
- Now Playing widget with album art and animated equalizer
- Historical data views: 6h, 24h, 7d, 30d, 90d

### 📈 Interactive Charts
- Chart.js with zoom & pan capabilities
- Multiple metric visualizations
- Smooth animations and transitions
- Responsive design for all screen sizes

### 🔐 Authentication
- AWS Cognito integration
- Email/password login
- Google SSO support
- JWT token management
- Secure session handling

### 📱 Progressive Web App
- Installable on iOS & Android
- Offline support with service worker
- "Add to Home Screen" prompt
- Responsive: Mobile bottom nav, Desktop sidebar
- Native-like performance

### 🚀 Additional Features
- **CSV Export** - Download data for any time range
- **Keyboard Shortcuts** - R (refresh), E (export)
- **Sound Alerts Toggle**
- **Live Clock** in top bar
- **Error Handling** - Futuristic "Signal Lost" pages
- **Auto-refresh** - Configurable polling interval

## 🛠️ Tech Stack

### Frontend
- **React 18** - UI library
- **TypeScript** - Type safety
- **Vite** - Lightning-fast build tool
- **Tailwind CSS 3.4+** - Utility-first styling
- **Framer Motion** - Smooth animations

### Charts & Data
- **Chart.js** - Data visualization
- **chartjs-plugin-zoom** - Interactive charts
- **date-fns** - Date formatting

### Mobile & PWA
- **Capacitor** - Native wrapper
- **vite-plugin-pwa** - PWA support
- **Service Worker** - Offline caching

### Backend Integration
- **AWS Amplify** - Hosting & CI/CD
- **AWS Cognito** - Authentication
- **REST API** - Data fetching

## 📦 Installation

### Prerequisites
- Node.js 18+ and npm/yarn
- Git

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd pulse-dashboard-pwa

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your AWS credentials
# VITE_COGNITO_USER_POOL_ID=your_pool_id
# VITE_COGNITO_CLIENT_ID=your_client_id

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

## 🎨 PWA Assets Setup

Before deploying, add PWA icons to the `/public` folder:

1. **Required files:**
   - `pwa-192x192.png` (192x192px)
   - `pwa-512x512.png` (512x512px)
   - `favicon.ico`
   - `apple-touch-icon.png` (180x180px)

2. **Quick generation:**
   - Visit [PWA Builder Image Generator](https://www.pwabuilder.com/imageGenerator)
   - Upload your 512x512px logo
   - Download and copy to `/public`

See `/public/ASSETS_README.md` for detailed instructions.

## 🚀 Deployment

### Deploy to AWS Amplify

1. **Create Amplify App:**
```bash
# Install Amplify CLI
npm install -g @aws-amplify/cli

# Configure Amplify
amplify configure

# Initialize Amplify in project
amplify init
```

2. **Connect Git Repository:**
   - Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
   - Click "New app" → "Host web app"
   - Connect your GitHub/GitLab repository
   - Amplify will auto-detect `amplify.yml` config

3. **Set Environment Variables:**
   - In Amplify Console, go to "Environment variables"
   - Add your Cognito credentials:
     - `VITE_COGNITO_USER_POOL_ID`
     - `VITE_COGNITO_CLIENT_ID`
     - `VITE_API_BASE_URL`

4. **Deploy:**
```bash
# Commit and push
git add .
git commit -m "Deploy Pulse Dashboard"
git push origin main

# Amplify will auto-deploy on push
```

Your app will be live at: `https://main.xxxxx.amplifyapp.com`

### Build for Production

```bash
# Create optimized build
npm run build

# Preview production build
npm run preview

# Output will be in /dist folder
```

### Deploy to Other Platforms

#### Vercel
```bash
npm i -g vercel
vercel
```

#### Netlify
```bash
npm i -g netlify-cli
netlify deploy --prod
```

## 📱 Mobile App (iOS/Android)

### Build Native Apps with Capacitor

1. **Add platforms:**
```bash
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
```

2. **Build web assets:**
```bash
npm run build
npx cap sync
```

3. **Open in IDE:**
```bash
# iOS (requires macOS + Xcode)
npx cap open ios

# Android (requires Android Studio)
npx cap open android
```

4. **Configure app:**
   - Edit `capacitor.config.ts` for app ID and name
   - Update icons in platform-specific folders
   - Build and deploy through Xcode/Android Studio

## 🔧 Configuration

### AWS Cognito Setup

1. **Create User Pool:**
   - Go to AWS Cognito Console
   - Create new User Pool
   - Enable email sign-in
   - Add custom attributes: `venueId`, `venueName`

2. **Configure App Client:**
   - Create app client (no client secret)
   - Enable Google OAuth (optional)
   - Add callback URLs

3. **Update .env:**
```env
VITE_COGNITO_USER_POOL_ID=us-east-1_xxxxxx
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxx
VITE_API_BASE_URL=https://api.advizia.ai
```

### API Integration

The app expects the following API endpoints:

```
GET /history/{venueId}?days=X
Response: Array of sensor data

GET /live/{venueId}
Response: Latest sensor reading
```

**Data format:**
```json
{
  "timestamp": "2024-01-01T12:00:00Z",
  "decibels": 65.5,
  "light": 350,
  "indoorTemp": 72.5,
  "outdoorTemp": 68.0,
  "humidity": 45.2,
  "currentSong": "Song Name",
  "albumArt": "https://..."
}
```

## 🎯 Usage

### Keyboard Shortcuts
- **R** - Refresh data
- **E** - Export CSV

### Features Demo

1. **Login:**
   - Demo mode: Any credentials work
   - Production: Use Cognito credentials

2. **Live View:**
   - Real-time metrics update every 15s
   - View comfort level gauge
   - See now playing music

3. **Historical Data:**
   - Select time range (6h, 24h, 7d, 30d, 90d)
   - Interactive charts with zoom/pan
   - Export data as CSV

4. **Install as PWA:**
   - Desktop: Click install icon in address bar
   - Mobile: "Add to Home Screen" from browser menu

## 🔍 Project Structure

```
pulse-dashboard-pwa/
├── public/               # Static assets
│   ├── manifest.json    # PWA manifest
│   ├── sw.js           # Service worker
│   └── [icons]         # PWA icons
├── src/
│   ├── components/     # React components
│   │   ├── AnimatedBackground.tsx
│   │   ├── ComfortGauge.tsx
│   │   ├── DataChart.tsx
│   │   ├── Logo.tsx
│   │   ├── MetricCard.tsx
│   │   ├── NowPlaying.tsx
│   │   ├── Sidebar.tsx
│   │   ├── TimeRangeToggle.tsx
│   │   └── TopBar.tsx
│   ├── pages/          # Page components
│   │   ├── Dashboard.tsx
│   │   ├── Login.tsx
│   │   ├── Error404.tsx
│   │   └── Offline.tsx
│   ├── services/       # API & Auth services
│   │   ├── api.service.ts
│   │   └── auth.service.ts
│   ├── hooks/          # Custom hooks
│   │   ├── useKeyboardShortcuts.ts
│   │   └── useRealTimeData.ts
│   ├── utils/          # Utility functions
│   │   ├── comfort.ts
│   │   └── format.ts
│   ├── types/          # TypeScript types
│   ├── config/         # Configuration
│   ├── App.tsx         # Main app component
│   ├── main.tsx        # Entry point
│   └── index.css       # Global styles
├── amplify.yml         # Amplify deploy config
├── capacitor.config.ts # Capacitor config
├── tailwind.config.js  # Tailwind config
├── vite.config.ts      # Vite config
└── package.json        # Dependencies
```

## 🎨 Design Customization

### Colors
Edit `tailwind.config.js`:
```js
colors: {
  navy: '#0a192f',      // Background
  cyan: '#00d4ff',      // Accent
  // Add your colors
}
```

### Animations
Edit `src/index.css`:
```css
.glass-card {
  /* Customize glassmorphism */
}
```

### Comfort Level Formula
Edit `src/utils/comfort.ts`:
```typescript
export function calculateComfortLevel(data: SensorData) {
  // Customize calculation logic
}
```

## 🐛 Troubleshooting

### Build Errors
```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
```

### PWA Not Installing
- Check all required icons exist in `/public`
- Verify `manifest.json` is served correctly
- Ensure HTTPS (required for PWA)
- Test in Incognito/Private mode

### AWS Cognito Issues
- Verify User Pool ID and Client ID
- Check callback URLs match deployment URL
- Ensure IAM permissions are correct

### Charts Not Displaying
```bash
# Reinstall chart dependencies
npm install chart.js react-chartjs-2 chartjs-plugin-zoom chartjs-adapter-date-fns
```

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📞 Support

For issues or questions:
- Open a GitHub issue
- Check documentation in `/public/ASSETS_README.md`
- Review AWS Amplify/Cognito docs

## 🎉 Credits

Built with:
- React ecosystem
- Tailwind CSS
- Framer Motion
- Chart.js
- AWS Services

---

**Made with ⚡ by a $10B IoT company's senior product designer & full-stack engineer**

🚀 **Deploy now and enjoy your futuristic dashboard!**
