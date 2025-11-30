import { ExpoRouter } from 'expo-router';

export default function Layout() {
  return <ExpoRouter web={{ useHash: true }} />;
}
