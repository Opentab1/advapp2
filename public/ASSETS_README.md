# PWA Assets Guide

This folder needs the following image assets for the PWA to work properly:

## Required Images

### 1. PWA Icons
- **pwa-192x192.png** (192x192px) - Standard PWA icon
- **pwa-512x512.png** (512x512px) - Large PWA icon (maskable)

### 2. App Icons
- **favicon.ico** - Browser favicon
- **apple-touch-icon.png** (180x180px) - iOS home screen icon

### 3. Screenshots (Optional but Recommended)
- **screenshot-wide.png** (1280x720px) - Desktop screenshot
- **screenshot-mobile.png** (750x1334px) - Mobile screenshot

## How to Generate

### Option 1: Use an Online Tool
1. Visit https://www.pwabuilder.com/imageGenerator
2. Upload a 512x512px source image (your logo)
3. Download the generated assets
4. Copy them to this `/public` folder

### Option 2: Manual Creation
Create a simple icon with:
- Navy blue background (#0a192f)
- Cyan pulse/heartbeat line (#00d4ff)
- Circular or square shape

### Option 3: Placeholder (Quick Start)
For development, you can use solid color placeholders:
```bash
# Install ImageMagick (if not installed)
# brew install imagemagick  # macOS
# apt-get install imagemagick  # Ubuntu

convert -size 192x192 xc:#0a192f pwa-192x192.png
convert -size 512x512 xc:#0a192f pwa-512x512.png
convert -size 180x180 xc:#0a192f apple-touch-icon.png
```

## Design Guidelines

- Use the app's color scheme (navy #0a192f background, cyan #00d4ff accent)
- Ensure the icon is recognizable at small sizes
- For maskable icons, keep important content in the safe zone (80% center)
- Use high contrast for visibility

## Verification

After adding assets, verify:
1. Icons appear in browser tab
2. "Add to Home Screen" shows correct icon
3. Installed PWA displays proper icon on device
