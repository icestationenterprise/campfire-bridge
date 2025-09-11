import AsyncStorage from '@react-native-async-storage/async-storage';
import ApiService from './api';

const AUTH_TOKEN_KEY = 'campfire_auth_token';

export async function login(pass: string): Promise<boolean> {
try {
const token = await ApiService.login(pass);
await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
return true;
} catch (error) {
console.error('Login failed:', error);
return false;
}
}

export async function getToken(): Promise<string | null> {
return AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function logout(): Promise<void> {
await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}
