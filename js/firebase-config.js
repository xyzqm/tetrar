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
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// Online play is considered available only once a databaseURL is provided.
export const FIREBASE_ENABLED = Boolean(firebaseConfig.databaseURL);
