// ---------------------------------------------------------------------------
// Firebase configuration for online play.
//
// Online mode is OFF until you fill this in. To enable it:
//   1. Create a free project at https://console.firebase.google.com/
//   2. In the project, create a "Realtime Database" (pick a location; start in
//      test mode for now — see the rules note in README.md).
//   3. Project settings -> "Your apps" -> add a Web app -> copy its config.
//   4. Paste the values below. The important one for Realtime Database is
//      `databaseURL` (looks like https://<project>-default-rtdb.firebaseio.com).
//
// These values are NOT secrets — Firebase web config is meant to ship in the
// client. Access is controlled by your database security rules (see README).
// ---------------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "AIzaSyCUVUh4NuPKPW_QOD1bEZvg4FHDn4uotqc",
  authDomain: "tetrar-4128a.firebaseapp.com",
  databaseURL: "https://tetrar-4128a-default-rtdb.firebaseio.com",
  projectId: "tetrar-4128a",
  storageBucket: "tetrar-4128a.firebasestorage.app",
  messagingSenderId: "965693956621",
  appId: "1:965693956621:web:71e245ca87d711ae982b44",
  measurementId: "G-LNECWQWW67"
};

// Online play is considered available only once a databaseURL is provided.
export const FIREBASE_ENABLED = Boolean(firebaseConfig.databaseURL);
