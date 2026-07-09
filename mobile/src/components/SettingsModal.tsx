import { useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { base64ToUint8Array } from '../utils/base64';
import { avatarUriFor } from '../utils/avatarUri';
import MascotAvatar from './MascotAvatar';
import type { Profile } from '../types';

interface Props {
  visible: boolean;
  onClose: () => void;
  isDark: boolean;
  themeMode: 'light' | 'dark' | 'auto';
  onSetThemeMode: (mode: 'light' | 'dark' | 'auto') => void;
  profile: Profile | null;
  onChangeSkin: (idx: number) => void;
  onPhotoChanged: (path: string | null) => void;
  onRequestSignIn: () => void;
}

const SKIN_COUNT = 5;
const THEME_OPTIONS = [
  { value: 'auto' as const, label: 'Auto', icon: 'contrast-outline' },
  { value: 'light' as const, label: 'Light', icon: 'sunny-outline' },
  { value: 'dark' as const, label: 'Dark', icon: 'moon-outline' },
];

export default function SettingsModal({
  visible, onClose, isDark, themeMode, onSetThemeMode, profile, onChangeSkin, onPhotoChanged, onRequestSignIn,
}: Props) {
  const { user, isAnonymous, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const pickAvatarPhoto = async (source: 'camera' | 'library') => {
    if (!user) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Access needed', 'Enable access in Settings to add a photo.');
      return;
    }
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true, allowsEditing: true, aspect: [1, 1] })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, base64: true, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets?.[0]?.base64) return;

    setUploadingPhoto(true);
    try {
      const path = `avatars/${user.id}-${Date.now()}.jpg`;
      const bytes = base64ToUint8Array(result.assets[0].base64);
      const { error: uploadError } = await supabase.storage.from('building-photos').upload(path, bytes, { contentType: 'image/jpeg' });
      if (uploadError) { Alert.alert('Upload Failed', uploadError.message); return; }

      const { error } = await supabase.from('profiles').update({ avatar_photo_path: path }).eq('user_id', user.id);
      if (error) { Alert.alert('Error', error.message); return; }
      onPhotoChanged(path);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!user) return;
    await supabase.from('profiles').update({ avatar_photo_path: null }).eq('user_id', user.id);
    onPhotoChanged(null);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your profile, climbs, badges, and everything else tied to your account. This can\'t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await supabase.rpc('delete_own_account');
            setDeleting(false);
            if (error) {
              Alert.alert('Error', error.message);
              return;
            }
            onClose();
            await signOut();
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[st.container, isDark && { backgroundColor: '#111827' }]}>
        <View style={[st.header, isDark && { borderBottomColor: '#374151' }]}>
          <Text style={[st.headerTitle, isDark && { color: '#F9FAFB' }]}>Settings</Text>
          <TouchableOpacity onPress={onClose} style={st.closeBtn}>
            <Ionicons name="close" size={24} color={isDark ? '#F9FAFB' : '#111827'} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={st.scrollContent}>
          {/* Account */}
          <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }]}>Account</Text>
          <View style={[st.card, isDark && { backgroundColor: '#1F2937' }]}>
            <Text style={[st.accountEmail, isDark && { color: '#F9FAFB' }]}>
              {isAnonymous ? 'Guest — not signed in' : (user?.email ?? '')}
            </Text>
            {isAnonymous ? (
              <TouchableOpacity style={st.primaryBtn} onPress={() => { onClose(); onRequestSignIn(); }}>
                <Text style={st.primaryBtnText}>Sign In / Create Account</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[st.secondaryBtn, isDark && { backgroundColor: '#374151' }]}
                onPress={() => {
                  Alert.alert('Sign out', 'Are you sure?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Sign Out', style: 'destructive', onPress: () => { onClose(); signOut(); } },
                  ]);
                }}
              >
                <Text style={[st.secondaryBtnText, isDark && { color: '#F9FAFB' }]}>Sign Out</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Appearance */}
          <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }]}>Appearance</Text>
          <View style={[st.card, isDark && { backgroundColor: '#1F2937' }, st.themeRow]}>
            {THEME_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[st.themeOption, isDark && { backgroundColor: '#374151' }, themeMode === opt.value && st.themeOptionActive]}
                onPress={() => onSetThemeMode(opt.value)}
              >
                <Ionicons name={opt.icon as any} size={20} color={themeMode === opt.value ? '#FFFFFF' : (isDark ? '#D1D5DB' : '#6B7280')} />
                <Text style={[st.themeOptionText, themeMode === opt.value && st.themeOptionTextActive, isDark && themeMode !== opt.value && { color: '#D1D5DB' }]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Avatar */}
          {!isAnonymous && (
            <>
              <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }]}>Avatar</Text>
              <View style={[st.card, isDark && { backgroundColor: '#1F2937' }]}>
                <View style={st.photoRow}>
                  <MascotAvatar skinIdx={profile?.avatar_idx ?? 0} photoUri={avatarUriFor(profile)} size={56} />
                  <View style={{ flex: 1, gap: 8 }}>
                    <TouchableOpacity
                      style={[st.photoBtn, isDark && { backgroundColor: '#374151' }]}
                      onPress={() => Alert.alert('Profile Photo', '', [
                        { text: 'Take Photo', onPress: () => pickAvatarPhoto('camera') },
                        { text: 'Choose from Library', onPress: () => pickAvatarPhoto('library') },
                        { text: 'Cancel', style: 'cancel' },
                      ])}
                      disabled={uploadingPhoto}
                    >
                      {uploadingPhoto ? <ActivityIndicator size="small" color="#2563EB" /> : (
                        <Text style={st.photoBtnText}>{profile?.avatar_photo_path ? 'Change Photo' : 'Upload a Photo'}</Text>
                      )}
                    </TouchableOpacity>
                    {profile?.avatar_photo_path && (
                      <TouchableOpacity onPress={handleRemovePhoto}>
                        <Text style={st.removePhotoText}>Use mascot avatar instead</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              <View style={[st.card, isDark && { backgroundColor: '#1F2937' }, st.avatarRow, { marginTop: 12 }]}>
                {Array.from({ length: SKIN_COUNT }).map((_, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[st.avatarOption, !profile?.avatar_photo_path && profile?.avatar_idx === idx && st.avatarOptionActive]}
                    onPress={() => onChangeSkin(idx)}
                  >
                    <MascotAvatar skinIdx={idx} size={44} />
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {/* Danger zone */}
          {!isAnonymous && (
            <>
              <Text style={[st.sectionLabel, { color: '#EF4444' }]}>Danger Zone</Text>
              <View style={[st.card, isDark && { backgroundColor: '#1F2937' }]}>
                <TouchableOpacity style={st.deleteBtn} onPress={handleDeleteAccount} disabled={deleting}>
                  {deleting ? <ActivityIndicator size="small" color="#EF4444" /> : <Text style={st.deleteBtnText}>Delete Account</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#111827' },
  closeBtn: { padding: 4 },
  scrollContent: { padding: 20, paddingBottom: 48 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
  },
  accountEmail: { fontSize: 14, fontWeight: '600', color: '#111827', marginBottom: 12 },
  primaryBtn: { backgroundColor: '#2563EB', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: { backgroundColor: '#F3F4F6', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#374151', fontWeight: '700', fontSize: 14 },
  themeRow: { flexDirection: 'row', gap: 10 },
  themeOption: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: '#F3F4F6' },
  themeOptionActive: { backgroundColor: '#2563EB' },
  themeOptionText: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  themeOptionTextActive: { color: '#FFFFFF' },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photoBtn: { backgroundColor: '#F3F4F6', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  photoBtnText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  removePhotoText: { fontSize: 12, fontWeight: '600', color: '#9CA3AF' },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  avatarOption: { padding: 6, borderRadius: 30, borderWidth: 2, borderColor: 'transparent' },
  avatarOptionActive: { borderColor: '#2563EB' },
  deleteBtn: { alignItems: 'center', paddingVertical: 6 },
  deleteBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
});
