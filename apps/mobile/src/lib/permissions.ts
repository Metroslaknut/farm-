import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';

import { toResult, type PermissionResult } from './permission-result';

export type { PermissionResult };

/**
 * Ask just-in-time, when the user taps a feature that needs it (never on launch).
 * The system prompt text comes from the strings configured in app.json (Thai, with the reason).
 */
export const requestCamera = async (): Promise<PermissionResult> =>
  toResult(await Camera.requestCameraPermissionsAsync());
export const requestMicrophone = async (): Promise<PermissionResult> =>
  toResult(await Camera.requestMicrophonePermissionsAsync());
/** Android 13+/iOS limited library use the system picker, which needs no broad media permission. */
export const requestMediaLibrary = async (): Promise<PermissionResult> =>
  toResult(await ImagePicker.requestMediaLibraryPermissionsAsync());

export const openAppSettings = (): Promise<void> => Linking.openSettings();
