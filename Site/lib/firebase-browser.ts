import { getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { firebaseConfig } from './firebase-config';

const existing = getApps().length > 0;
const emulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
const config = emulator ? {
  ...firebaseConfig, apiKey: 'demo-eduid-key', projectId: 'demo-eduid',
  databaseURL: 'http://127.0.0.1:9000/?ns=demo-eduid-default-rtdb',
} : firebaseConfig;
const app = existing ? getApp() : initializeApp(config);
export const auth = getAuth(app);
export const database = emulator || config.databaseURL ? getDatabase(app) : null;
if (emulator && !existing && database) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectDatabaseEmulator(database, '127.0.0.1', 9000);
}
