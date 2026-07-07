import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  visible: boolean;
  reason?: string;  // e.g. "log climbs", "verify building height"
  onClose: () => void;
  onSuccess?: () => void;  // called after successful sign-in
}

export default function AuthPrompt({ visible, reason, onClose, onSuccess }: Props) {
  const { signUpWithEmail, signInWithEmail } = useAuth();
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const reset = () => {
    setEmail('');
    setPassword('');
    setError(null);
    setConfirmMsg(null);
    setLoading(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setError(null);
    setConfirmMsg(null);

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    const result = mode === 'signup'
      ? await signUpWithEmail(email, password)
      : await signInWithEmail(email, password);
    setLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (mode === 'signup' && 'needsConfirmation' in result && result.needsConfirmation) {
      setConfirmMsg('Check your email to confirm your account, then come back and log in.');
      return;
    }

    onSuccess?.();
    handleClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleClose} />
        <View style={styles.sheet}>
          <Text style={styles.title}>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</Text>

          {reason && (
            <Text style={styles.reason}>
              Sign in to {reason}. Your climbs and verifications sync across devices.
            </Text>
          )}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'signup' ? 'new-password' : 'password'}
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />

          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>{mode === 'signup' ? 'Sign Up' : 'Log In'}</Text>
            )}
          </TouchableOpacity>

          {confirmMsg && (
            <View style={styles.confirmBox}>
              <Ionicons name="mail-outline" size={16} color="#2563EB" />
              <Text style={styles.confirmText}>{confirmMsg}</Text>
            </View>
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={styles.switchMode}
            onPress={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); setConfirmMsg(null); }}
          >
            <Text style={styles.switchModeText}>
              {mode === 'signup' ? 'Already have an account? Log in' : "New here? Create an account"}
            </Text>
          </TouchableOpacity>

          {/* Dismiss */}
          <TouchableOpacity
            style={styles.dismiss}
            onPress={handleClose}
            activeOpacity={0.7}
          >
            <Text style={styles.dismissText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingTop: 90,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 28,
    alignItems: 'center',
    width: '88%',
    maxWidth: 400,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  reason: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  input: {
    width: '100%',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 15,
    color: '#111827',
    marginBottom: 12,
  },
  submitBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
    marginBottom: 8,
    minHeight: 50,
    backgroundColor: '#2563EB',
  },
  submitText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  confirmBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    width: '100%',
  },
  confirmText: {
    flex: 1,
    fontSize: 13,
    color: '#2563EB',
    lineHeight: 18,
  },
  error: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  switchMode: {
    marginTop: 16,
    paddingVertical: 4,
  },
  switchModeText: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '600',
  },
  dismiss: {
    marginTop: 12,
    paddingVertical: 8,
  },
  dismissText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
});
