Good. This is where you go from “project” → “real product.” I’ll give you the **exact path** without fluff, optimized for your Expo setup.

---

# 🧠 Big picture

You are doing:

* **iOS:** TestFlight (Apple)
* **Android:** Internal Testing (Google Play)

You do NOT need public release yet.

---

# 🍏 iOS (TestFlight beta)

## Step 1 — Create Apple Developer account

* Go to: [https://developer.apple.com](https://developer.apple.com)
* Pay $99/year
* Create App ID: `com.nearr.app` (or whatever you used)

---

## Step 2 — Create app in App Store Connect

Go to: [https://appstoreconnect.apple.com](https://appstoreconnect.apple.com)

* Apps → “+” → New App
* Name: Nearr
* Bundle ID: must match your Expo config
* SKU: anything (e.g. `nearr-v1`)
* Platform: iOS

---

## Step 3 — Configure Expo for iOS build

In your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "name": "Nearr",
    "slug": "nearr",
    "ios": {
      "bundleIdentifier": "com.nearr.app"
    }
  }
}
```

---

## Step 4 — Build with EAS

If you haven’t already:

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Then:

```bash
eas build --platform ios --profile preview
```

---

## Step 5 — Submit to TestFlight

```bash
eas submit --platform ios
```

OR upload via App Store Connect if prompted.

---

## Step 6 — Wait for processing

* Usually 10–30 minutes (sometimes longer)
* No full review required for internal testing

---

## Step 7 — Add testers

In App Store Connect:

* TestFlight tab
* Internal testers → add emails
* External testers → optional (needs quick Apple review)

---

## Step 8 — Share link

Testers install via:

* TestFlight app
* Invite link

---

# 🤖 Android (Google Play beta)

## Step 1 — Create Google Play Developer account

* [https://play.google.com/console](https://play.google.com/console)
* One-time $25 fee

---

## Step 2 — Create app

* Create new app
* Name: Nearr
* Default language
* App type: App
* Free (for now)

---

## Step 3 — Configure Expo Android

```json
{
  "expo": {
    "android": {
      "package": "com.nearr.app"
    }
  }
}
```

---

## Step 4 — Build APK/AAB

```bash
eas build --platform android --profile preview
```

This will generate an **.aab file** (required for Play Store)

---

## Step 5 — Upload to Play Console

* Go to: Release → Testing → Internal testing
* Create new release
* Upload `.aab`
* Add release notes (just say “Beta build”)

---

## Step 6 — Add testers

* Add emails OR generate share link
* Users install via Play Store link

---

# 🔥 What you actually need for BOTH

## App icon

* 1024x1024 PNG

## Basic info

* Name
* Description (keep simple)

Example:

> “Save places from TikTok and Instagram and see them on your map.”

---

## Screenshots (can be basic for beta)

* map screen
* save flow
* nearby screen

---

# ⚠️ Common mistakes (avoid these)

### ❌ Using Expo Go

* Won’t work for beta
* You need **EAS build**

---

### ❌ Bundle ID mismatch

* Must match exactly everywhere

---

### ❌ Waiting for perfection

* Don’t

---

# 🧠 What your beta should focus on

Not:

* UI polish
* social features

But:

* save from link works
* map works
* users understand product

---

# 🚀 Recommended rollout

### Week 1

* 10–20 testers (friends)

### Week 2

* 50–100 testers

### Week 3+

* expand if retention is good

---

# 🔑 Final advice

Your goal is NOT:

> “get on the App Store”

Your goal is:

> **“get real people using this and breaking it”**

---

If you want next, I can:

* write your **App Store description + screenshots**
* or design your **onboarding for beta users (very important)**
