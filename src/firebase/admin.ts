import admin from 'firebase-admin';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const getFirebaseAdmin = () => {
  // Check if the app is already initialized to prevent re-initialization
  if (getApps().length === 0) {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!serviceAccountJson) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set. Cannot initialize Firebase Admin SDK.'
      );
    }

    try {
      initializeApp({
        credential: cert(JSON.parse(serviceAccountJson)),
      });
    } catch (error) {
      // Log the specific parsing or initialization error
      console.error('Failed to initialize Firebase Admin SDK:', error);
      throw new Error('Could not initialize Firebase Admin SDK. Check service account credentials.');
    }
  }

  return {
    adminDb: getFirestore(),
    adminAuth: getAuth(),
  };
};

export default getFirebaseAdmin;
