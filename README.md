# App Name

A React Native mobile application built for IAT351, focusing on Human-Computer Interaction (HCI) design principles, gamified climate action habit loops, and a structured peer-to-peer sustainability award economy.

---

## Prerequisites & Requirements

Before you begin, ensure you have the following:
*   **Node.js** (LTS version recommended) - [Download Node.js](https://nodejs.org/)
*   **Git** - [Download Git](https://git-scm.com/)
*   **Expo Go App** installed on your physical iOS or Android device (available on the App Store or Google Play Store).
*   **Expo Go Account** Sign up for an Expo Go Account.

---

## Getting Started (From Scratch)

### 1. Clone the Repository

### 2. Navigate into the cloned directory

### 3. Install Dependencies
Install all required project packages using npm:
```bash
npm install
```

### 4. Start the Development Server
Launch the Expo development server:
```bash
npx expo start
```
*   If you encounter cache or bundling issues, clear the cache by running:
    ```bash
    npx expo start --clear
    ```

### 5. Running on Your Phone
1. Open the **Expo Go** app on your physical device.
2. **If on iOS:** Use your phone's native Camera app to scan the QR code displayed in your terminal or browser, then tap "Open in Expo Go".
3. **If on Android:** Open Expo Go and scan the QR code directly inside the application.

---

## Core Architecture & Features
*   **Authentication & Onboarding:** Secure Firebase Auth coupled with a multi-step swipeable onboarding wizard enforcing unique public handles for social accountability.
*   **Quest Hub:** Curated daily environmental micro-actions (Easy, Medium, Hard) designed to reduce carbon footprint, backed by real-time Firestore synchronization and a point-to-token reroll economy.
*   **Community Feed:** A dual-mode (Global / Following) community feed with point gifting and post-reporting moderation flags.
*   **Rankings:** Real-time user leaderboard featuring search functionality and direct follow/unfollow capabilities.

---

## Development Team
*   Cooper Leong
*   Mahesh Jograna
*   Andrew D'Souza
*   Ben Liu
*   Joon Lee
*   Course: IAT351
