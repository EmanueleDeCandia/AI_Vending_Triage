import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase app
const app = initializeApp(firebaseConfig);

// Initialize Firestore with Database ID from configuration
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Initialize Firebase Authentication
export const auth = getAuth(app);

// Authentication Provider Setup
export const googleProvider = new GoogleAuthProvider();

// Standard login with Google Popup
export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Errore di autenticazione Google:', error);
    throw error;
  }
}

// Logout function
export async function logoutUser() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Errore durante il logout:', error);
    throw error;
  }
}

// Connection check according to rules
export async function validateFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Connessione a Firestore riuscita con successo.');
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Si prega di verificare la configurazione di Firebase.");
    }
    return false;
  }
}
