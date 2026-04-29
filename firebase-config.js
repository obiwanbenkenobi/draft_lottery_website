// Live-sync configuration. Replace the placeholders below with your Firebase
// project's web app config (Project Settings → General → Your apps → SDK setup).
//
// Without a real config the site still works locally — just no live sync.
//
// You also need to enable Realtime Database in test mode and set the rules so
// reads/writes are allowed (see README or commit message for sample rules).
window.firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// Optional: change to namespace multiple lotteries on the same Firebase project.
// All viewers and the host must share the same room ID.
window.lotteryRoomId = "default";
