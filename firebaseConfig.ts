// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB8J5V-4Uo-Sem01moJnCLDB0D4DC0KIDc",
  authDomain: "myinvestmentstatus-6cd1e.firebaseapp.com",
  projectId: "myinvestmentstatus-6cd1e",
  storageBucket: "myinvestmentstatus-6cd1e.firebasestorage.app",
  messagingSenderId: "290271540048",
  appId: "1:290271540048:web:688c25753a66c6edb9f255",
  measurementId: "G-JSGG2B5K1T"
};
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);