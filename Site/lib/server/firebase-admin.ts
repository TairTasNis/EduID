import 'server-only';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { firebaseConfig } from '../firebase-config';
import { configurationError } from './http';

export function firebaseAdmin() {
  const emulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true' && process.env.VERCEL !== '1';
  const databaseURL = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
  const credentialJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!emulator && !databaseURL) throw configurationError('NEXT_PUBLIC_FIREBASE_DATABASE_URL');
  const serviceCredential = () => {
    if (!credentialJson && !credentialPath) {
      throw configurationError('FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS');
    }
    try {
      const data = credentialJson ?? readFileSync(credentialPath!, 'utf8');
      return cert(JSON.parse(data.replace(/^\uFEFF/, '')));
    }
    catch { throw configurationError(credentialJson ? 'FIREBASE_SERVICE_ACCOUNT_JSON' : 'GOOGLE_APPLICATION_CREDENTIALS'); }
  };
  const app = getApps()[0] ?? initializeApp(emulator ? {
    projectId: 'demo-eduid', databaseURL: 'http://127.0.0.1:9000/?ns=demo-eduid-default-rtdb',
    storageBucket: 'demo-eduid.appspot.com',
    credential: cert({
      projectId: 'demo-eduid', clientEmail: 'eduid-emulator@demo-eduid.iam.gserviceaccount.com',
      privateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }),
  } : {
    projectId: firebaseConfig.projectId, databaseURL, storageBucket: firebaseConfig.storageBucket,
    credential: serviceCredential(),
  });
  return { auth: getAuth(app), db: getDatabase(app), bucket: () => getStorage(app).bucket() };
}
