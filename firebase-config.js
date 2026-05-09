// Live-sync configuration. Replace the placeholders below with your Firebase
// project's web app config (Project Settings → General → Your apps → SDK setup).
//
// Without a real config the site still works locally — just no live sync.
//
// You also need to enable Realtime Database in test mode and set the rules so
// reads/writes are allowed (see README or commit message for sample rules).
window.firebaseConfig = {
  apiKey: "AIzaSyBXqUHrMKia51mssM_t0Y6e5VZWC_itAqs",
  authDomain: "fantasy-draft-lottery-odds.firebaseapp.com",
  databaseURL: "https://fantasy-draft-lottery-odds-default-rtdb.firebaseio.com",
  projectId: "fantasy-draft-lottery-odds",
  storageBucket: "fantasy-draft-lottery-odds.firebasestorage.app",
  messagingSenderId: "7098049692",
  appId: "1:7098049692:web:fb87cce8bc23213a277959",
};

// Optional: change to namespace multiple lotteries on the same Firebase project.
// All viewers and the host must share the same room ID.
window.lotteryRoomId = "default";
