import * as admin from 'firebase-admin';

// Check if the app is already initialized to prevent errors
if (!admin.apps.length) {
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!serviceAccountJson) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set.');
    }

    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceAccountJson))
    });
  } catch (error) {
    console.error('Firebase Admin initialization error:', error);
  }
}

export const adminAuth = admin.auth();
export const adminDb = admin.firestore();
