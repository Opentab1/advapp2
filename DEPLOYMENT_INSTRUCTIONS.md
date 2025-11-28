# 🚀 Deployment Instructions - Certificate Auto-Download Feature

## ⚠️ IMPORTANT: These changes are SAFE for your live client
- ✅ NO changes to IoT Rule
- ✅ NO changes to data flow
- ✅ ONLY updates venue creation process
- ✅ Your current client's data will NOT be affected

---

## 📋 What These Changes Do

**Before:**
1. Admin creates venue
2. Gets error if user already exists
3. No certificate download
4. Venues list doesn't refresh

**After:**
1. Admin creates venue ✅
2. Handles existing users gracefully ✅
3. Auto-downloads certificate package ✅
4. Shows success message with password ✅
5. Closes modal automatically ✅

---

## 🔧 DEPLOYMENT STEPS

### **STEP 1: Update createVenue Lambda Function**

**Time: 5 minutes**

1. **Open AWS Console** → Lambda → Functions → `createVenue`

2. **Click "Code" tab**

3. **Replace ALL code** with the content from:
   `/workspace/lambda-functions/createVenue-UPDATED.js`

4. **Click "Deploy"** button (top right)

5. **Wait for "Successfully deployed"** message

**That's it for Lambda!** ✅

---

### **STEP 2: Deploy Frontend Changes**

**Time: 2 minutes**

The frontend file has been updated:
- `/workspace/src/pages/admin/VenuesManagement.tsx`

**If you're using AWS Amplify:**
1. Commit the changes to git
2. Push to your main branch
3. Amplify will auto-deploy

**If you're deploying manually:**
1. Run: `npm run build`
2. Deploy the `/dist` folder

---

## 🧪 TESTING PLAN

### **Test 1: Create New Venue with Fresh Email**

1. Login to admin dashboard
2. Go to "Venues Management"
3. Click "Create New Venue"
4. Fill form with:
   - Venue Name: "Test Venue 2"
   - Owner Email: `newtest@example.com` (must be NEW email)
   - Fill other fields
5. Click Submit

**Expected Results:**
- ✅ Success message appears
- ✅ Shows temp password
- ✅ File downloads: `pulse-testvenue2-certificates.json`
- ✅ Modal closes automatically

---

### **Test 2: Create Venue with Existing Email (Error Handling)**

1. Try creating venue with email that already exists
2. Should still work (skips user creation, creates venue/device)

**Expected Results:**
- ✅ Success message appears
- ✅ Certificates still download
- ✅ No error about existing user

---

## 📥 What Gets Downloaded

When you create a venue, a JSON file downloads: `pulse-VENUEID-certificates.json`

**This file contains:**
```json
{
  "venueId": "testvenue2",
  "deviceId": "testvenue2-mainfloor-001",
  "files": {
    "certificates/certificate.pem.crt": "-----BEGIN CERTIFICATE-----...",
    "certificates/private.pem.key": "-----BEGIN RSA PRIVATE KEY-----...",
    "certificates/public.pem.key": "-----BEGIN PUBLIC KEY-----...",
    "certificates/root-CA.crt": "-----BEGIN CERTIFICATE-----...",
    "config.json": "{ venueId, deviceId, ... }",
    "venue-info.json": "{ metadata }",
    "INSTRUCTIONS.txt": "Setup instructions"
  },
  "metadata": { ... }
}
```

---

## 🔨 How to Extract Certificates on RPI

**Option 1: Manual Extraction (Current)**

1. Download the JSON file
2. Open in text editor
3. Copy each certificate content
4. Create files manually on RPI:
   ```bash
   mkdir -p /home/pi/certs
   nano /home/pi/certs/certificate.pem.crt  # Paste certificate
   nano /home/pi/certs/private.pem.key      # Paste private key
   nano /home/pi/certs/root-CA.crt          # Paste root CA
   ```

**Option 2: Python Extraction Script (Recommended)**

Create `extract-certs.py` on your RPI:
```python
import json
import os

# Load the bundle
with open('pulse-VENUEID-certificates.json', 'r') as f:
    bundle = json.load(f)

# Create directories
os.makedirs('/home/pi/certs', exist_ok=True)

# Extract each file
for filepath, content in bundle['files'].items():
    if filepath.startswith('certificates/'):
        filename = filepath.replace('certificates/', '')
        output_path = f'/home/pi/certs/{filename}'
        with open(output_path, 'w') as f:
            f.write(content)
        print(f'✅ Created: {output_path}')

print('✅ All certificates extracted!')
print(f"Venue ID: {bundle['venueId']}")
print(f"Device ID: {bundle['deviceId']}")
```

Then run:
```bash
python3 extract-certs.py
```

---

## 🔄 ROLLBACK PLAN (If Something Goes Wrong)

### **To Rollback Lambda:**
1. AWS Console → Lambda → `createVenue`
2. Click "Actions" → "Restore previous version"
3. Select the version before your update
4. Click "Restore"

### **To Rollback Frontend:**
1. Git: `git revert HEAD`
2. Push to trigger redeploy
3. Or redeploy previous build

---

## ❓ FAQ

**Q: Will this affect my current client's data?**
A: No! Zero impact on data flow. Only affects NEW venue creation.

**Q: What if the Lambda fails?**
A: The old behavior continues - error message shown, but venue/user still created in DynamoDB.

**Q: Can I test without affecting production?**
A: Yes! Just use test email addresses that don't exist yet.

**Q: What about real ZIP files?**
A: Phase 2 improvement - add JSZip library for proper ZIP format. Current JSON bundle works perfectly.

---

## ✅ SUCCESS CRITERIA

After deployment, verify:
- [ ] Can create new venue with fresh email
- [ ] Certificate bundle downloads automatically
- [ ] Success message shows temp password
- [ ] Modal closes after success
- [ ] No errors in browser console
- [ ] Current client's data still flowing normally

---

## 📞 Support

If you encounter issues:
1. Check browser console (F12) for errors
2. Check Lambda CloudWatch logs:
   ```bash
   aws logs tail /aws/lambda/createVenue --region us-east-2 --since 10m
   ```
3. Screenshot any errors and report back

---

**Ready to deploy?** Start with Step 1 (Lambda update) when you're ready!
