import { collection, doc, setDoc, getDoc, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { TriageSession, ChatMessage } from '../types';
import { handleFirestoreError, OperationType } from './firebaseError';

const COLLECTION_NAME = 'triage_sessions';

// Save or overwrite a complete session in Firestore
export async function saveSessionToFirestore(session: TriageSession): Promise<void> {
  const path = `${COLLECTION_NAME}/${session.id}`;
  try {
    const docRef = doc(db, COLLECTION_NAME, session.id);
    await setDoc(docRef, {
      ...session,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// Fetch all previous sessions for a specific user email
export async function fetchUserSessions(userEmail: string): Promise<TriageSession[]> {
  try {
    const sessionsRef = collection(db, COLLECTION_NAME);
    const q = query(
      sessionsRef,
      where('userEmail', '==', userEmail),
      orderBy('createdAt', 'desc')
    );
    const querySnapshot = await getDocs(q);
    const list: TriageSession[] = [];
    querySnapshot.forEach((doc) => {
      list.push(doc.data() as TriageSession);
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
    return [];
  }
}

// Get a single session by ID
export async function fetchSessionById(sessionId: string): Promise<TriageSession | null> {
  const path = `${COLLECTION_NAME}/${sessionId}`;
  try {
    const docRef = doc(db, COLLECTION_NAME, sessionId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data() as TriageSession;
    }
    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    return null;
  }
}
