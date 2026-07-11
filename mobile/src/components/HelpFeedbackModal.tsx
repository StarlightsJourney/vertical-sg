import { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Linking, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import { base64ToUint8Array } from '../utils/base64';
import PhotoGridPicker from './PhotoGridPicker';

const ACCENT = '#2563EB';

// Community channel (Telegram) — richer media (videos, screen recordings) and
// back-and-forth belong here; the in-app form is for structured reports.
const COMMUNITY_URL = 'https://t.me/madridlim';

const FAQ: { q: string; a: string }[] = [
  { q: 'How does climb tracking work?', a: 'On the map, tap a block → Track a Climb. If your phone has a barometer we measure real elevation gain; otherwise we estimate floors from your step count. The tracker also uses the accelerometer to ignore elevator/escalator rides.' },
  { q: 'Why did my badge go grey / reset?', a: 'The monthly HDB Elevation badges reset each calendar month, Overwatch-season style — re-complete that month\'s target to light it up again. Everything else is permanent once earned.' },
  { q: 'How do I post to the feed?', a: 'A climb only appears on the Social feed once you attach at least one photo (up to 6). Use the + button on Social, or "Add photo" on a climb you already logged.' },
  { q: 'What are the goals on Home?', a: 'Your weekly goal comes from your onboarding answers and is editable here. The monthly goal and next-month target are calculated from it using a progressive-overload rule.' },
  { q: 'Are the events real?', a: 'Yes — races and training sessions are a curated list of real events. Dates shift year to year, so tap through to the official page for the current schedule.' },
];

const CATEGORIES: { key: 'bug' | 'idea' | 'amenity' | 'other'; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'bug', label: 'Bug', icon: 'bug-outline' },
  { key: 'idea', label: 'Idea', icon: 'bulb-outline' },
  { key: 'amenity', label: 'Amenity', icon: 'location-outline' },
  { key: 'other', label: 'Other', icon: 'chatbox-ellipses-outline' },
];

export default function HelpFeedbackModal({ visible, onClose, isDark = false }: { visible: boolean; onClose: () => void; isDark?: boolean }) {
  const { user } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [category, setCategory] = useState<'bug' | 'idea' | 'amenity' | 'other'>('bug');
  const [message, setMessage] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!user) { Alert.alert('Sign in needed', 'Please sign in to send feedback.'); return; }
    if (!message.trim()) { Alert.alert('Add a message', 'Tell us what happened or what you\'d like to see.'); return; }
    setSubmitting(true);
    try {
      let screenshotPath: string | null = null;
      if (photos[0]) {
        const path = `feedback/${user.id}-${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage.from('building-photos').upload(path, base64ToUint8Array(photos[0]), { contentType: 'image/jpeg' });
        if (!upErr) screenshotPath = path;
      }
      const { error } = await supabase.from('feedback').insert({
        user_id: user.id,
        category,
        message: message.trim(),
        screenshot_path: screenshotPath,
        platform: Platform.OS,
      });
      if (error) { Alert.alert('Couldn\'t send', error.message); return; }
      Alert.alert('Thanks!', 'Your feedback was sent — we read every one.');
      setMessage(''); setPhotos([]); setCategory('bug');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[st.container, isDark && { backgroundColor: '#111827' }]}>
        <View style={[st.header, isDark && { borderBottomColor: '#374151', backgroundColor: '#111827' }]}>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="arrow-back" size={24} color={isDark ? '#F9FAFB' : '#111827'} />
          </TouchableOpacity>
          <Text style={[st.headerTitle, isDark && { color: '#F9FAFB' }]}>Help & Feedback</Text>
          <View style={{ width: 24 }} />
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}>
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[st.sectionLabel, isDark && { color: '#9CA3AF' }]}>FAQ</Text>
          {FAQ.map((item, i) => (
            <TouchableOpacity key={i} style={[st.faqRow, isDark && { backgroundColor: '#1F2937' }]} onPress={() => setOpenFaq(openFaq === i ? null : i)} activeOpacity={0.7}>
              <View style={st.faqQRow}>
                <Text style={[st.faqQ, isDark && { color: '#F9FAFB' }]}>{item.q}</Text>
                <Ionicons name={openFaq === i ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
              </View>
              {openFaq === i && <Text style={[st.faqA, isDark && { color: '#9CA3AF' }]}>{item.a}</Text>}
            </TouchableOpacity>
          ))}

          <Text style={[st.sectionLabel, { marginTop: 24 }, isDark && { color: '#9CA3AF' }]}>Report an issue or idea</Text>
          <View style={st.catRow}>
            {CATEGORIES.map((c) => {
              const active = category === c.key;
              return (
                <TouchableOpacity key={c.key} style={[st.catChip, active && st.catChipActive, isDark && !active && { backgroundColor: '#1F2937' }]} onPress={() => setCategory(c.key)}>
                  <Ionicons name={c.icon} size={14} color={active ? '#FFFFFF' : (isDark ? '#9CA3AF' : '#6B7280')} />
                  <Text style={[st.catChipText, active && { color: '#FFFFFF' }, isDark && !active && { color: '#9CA3AF' }]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TextInput
            style={[st.input, isDark && { backgroundColor: '#1F2937', color: '#F9FAFB', borderColor: '#374151' }]}
            placeholder="Describe what happened, or what you'd like to see…"
            placeholderTextColor="#9CA3AF"
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={4000}
          />

          <Text style={[st.attachLabel, isDark && { color: '#9CA3AF' }]}>Attach a screenshot (optional)</Text>
          <PhotoGridPicker photos={photos} onChange={setPhotos} max={1} emptyLabel="Add a screenshot" isDark={isDark} />

          <TouchableOpacity style={[st.submitBtn, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={st.submitText}>Send Feedback</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={st.communityRow} onPress={() => Linking.openURL(COMMUNITY_URL)} activeOpacity={0.7}>
            <Ionicons name="paper-plane-outline" size={16} color={ACCENT} />
            <Text style={st.communityText}>Have a video or want to chat? Join our community</Text>
          </TouchableOpacity>
        </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 56, paddingBottom: 14, paddingHorizontal: 16,
    backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#111827' },
  body: { padding: 16, paddingBottom: 48 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  faqRow: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 8 },
  faqQRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111827' },
  faqA: { fontSize: 13, color: '#6B7280', lineHeight: 19, marginTop: 8 },
  catRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F3F4F6', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 12 },
  catChipActive: { backgroundColor: ACCENT },
  catChipText: { fontSize: 12.5, fontWeight: '700', color: '#6B7280' },
  input: {
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12,
    padding: 14, fontSize: 14, color: '#111827', minHeight: 110, textAlignVertical: 'top', marginBottom: 14,
  },
  attachLabel: { fontSize: 12.5, color: '#6B7280', fontWeight: '600', marginBottom: 8 },
  submitBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  submitText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  communityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18, paddingVertical: 8 },
  communityText: { fontSize: 13, fontWeight: '600', color: ACCENT },
});
