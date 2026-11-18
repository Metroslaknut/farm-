import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface NetworkValue {
  /** false only when we positively know there is no connection (unknown/initial counts as online). */
  isOnline: boolean;
}

const NetworkContext = createContext<NetworkValue>({ isOnline: true });

export const isOffline = (
  state: Pick<NetInfoState, 'isConnected' | 'isInternetReachable'>,
): boolean => state.isConnected === false || state.isInternetReachable === false;

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((state) => setOnline(!isOffline(state))), []);
  const value = useMemo(() => ({ isOnline: online }), [online]);
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export const useNetwork = (): NetworkValue => useContext(NetworkContext);
