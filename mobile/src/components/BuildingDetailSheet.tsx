import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import * as ImagePicker from 'expo-image-picker';
import { compressToBase64 } from '../utils/compressImage';
import { supabase } from '../config/supabase';
import { useAuth } from '../contexts/AuthContext';
import { base64ToUint8Array } from '../utils/base64';
import AuthPrompt from './AuthPrompt';
import type { Block, HeightVerification, BuildingPhoto, VerificationState } from '../types';

interface Props {
  block: Block | null;
  visible: boolean;
  onClose: () => void;
}

function getTierColor(storeys: number): string {
  if (storeys <= 10) return '#4A90D9';
  if (storeys <= 20) return '#FF9500';
  if (storeys <= 30) return '#FF3B30';
  if (storeys <= 39) return '#8B0000';
  return '#7C3AED';
}

export default function BuildingDetailSheet({ block, visible, onClose }: Props) {
  const { user, isAnonymous } = useAuth();
  const [photos, setPhotos] = useState<BuildingPhoto[]>([]);
  const [verifications, setVerifications] = useState<HeightVerification[]>([]);
  const [verificationStatus, setVerificationStatus] = useState<VerificationState>('estimated');
  const [disputeCount, setDisputeCount] = useState(0);
  const [recentClimbs, setRecentClimbs] = useState<any[]>([]);
  const [ratingSummary, setRatingSummary] = useState({ avg: 0, count: 0 });
  const [myRating, setMyRating] = useState(0);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [, setLoading] = useState(true);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [pendingAuthAction, setPendingAuthAction] = useState<'verify' | 'photo' | 'rate' | 'comment' | null>(null);

  // Verification submission state
  const [verifyVisible, setVerifyVisible] = useState(false);
  const [verifyMeters, setVerifyMeters] = useState('');
  const [verifyPhotoBase64, setVerifyPhotoBase64] = useState<string | null>(null);
  const [verifySubmitting, setVerifySubmitting] = useState(false);

  const loadData = async () => {
    if (!block) return;
    setLoading(true);

    try {
      // Fetch verifications
      const { data: verifData } = await supabase
        .from('height_verifications')
        .select('*')
        .eq('block_id', block.block_id)
        .eq('status', 'active');

      if (verifData) setVerifications(verifData as HeightVerification[]);

      // Fetch verification status view
      const { data: statusData } = await supabase
        .from('block_verification_status')
        .select('*')
        .eq('block_id', block.block_id)
        .single();

      if (statusData) {
        setVerificationStatus(statusData.verification_state);
        setDisputeCount(statusData.dispute_count ?? 0);
      }

      // Fetch photos
      const { data: photoData } = await supabase
        .from('building_photos')
        .select('*')
        .eq('block_id', block.block_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (photoData) setPhotos(photoData as BuildingPhoto[]);

      // Fetch recent climbs
      const { data: climbData } = await supabase
        .from('climbs')
        .select('*, blocks(blk_no, street)')
        .eq('block_id', block.block_id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (climbData) setRecentClimbs(climbData);

      // Fetch rating summary
      const { data: ratingData } = await supabase
        .from('block_rating_summary')
        .select('*')
        .eq('block_id', block.block_id)
        .maybeSingle();

      setRatingSummary({ avg: ratingData?.avg_rating ?? 0, count: ratingData?.rating_count ?? 0 });

      if (user) {
        const { data: myRatingData } = await supabase
          .from('block_ratings')
          .select('rating')
          .eq('block_id', block.block_id)
          .eq('user_id', user.id)
          .maybeSingle();
        setMyRating(myRatingData?.rating ?? 0);
      }

      // Fetch comments — "from other climbers", shown right under the building's details
      const { data: commentData } = await supabase
        .from('block_comments')
        .select('*')
        .eq('block_id', block.block_id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(50);

      if (commentData) setComments(commentData);
    } catch (err) {
      console.error('Error loading building detail:', err);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (visible && block) loadData();
  }, [visible, block]);

  const handleVerifyPress = () => {
    if (isAnonymous) {
      setPendingAuthAction('verify');
      setAuthPromptVisible(true);
    } else {
      setVerifyVisible(true);
    }
  };

  const handleRemoveVerification = (verificationId: string) => {
    Alert.alert(
      'Remove Verification',
      'Remove your height verification for this building?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('height_verifications')
              .update({ status: 'removed' })
              .eq('verification_id', verificationId);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              loadData();
            }
          },
        },
      ],
    );
  };

  const handleAddPhoto = async (source: 'camera' | 'library') => {
    if (isAnonymous) {
      setPendingAuthAction('photo');
      setAuthPromptVisible(true);
      return;
    }

    try {
      let result;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Camera Access', 'Enable camera access in Settings to take photos.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true, base64: true });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Photo Access', 'Enable photo library access in Settings.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, allowsEditing: true, base64: true });
      }

      const asset = result.assets?.[0];
      if (!result.canceled && asset?.base64 && asset.uri) {
        await uploadPhoto(await compressToBase64(asset.uri, asset.base64));
      }
    } catch (err) {
      console.error('Photo picker error:', err);
    }
  };

  const uploadPhoto = async (base64: string) => {
    if (!user || !block) return;

    try {
      const path = `${block.block_id}/${Date.now()}.jpg`;

      // Upload raw bytes directly — fetch(uri).blob() is unreliable in React
      // Native for local file/content URIs, so we ask the picker for base64
      // instead and decode it ourselves rather than round-tripping through fetch.
      const bytes = base64ToUint8Array(base64);

      const { error: uploadError } = await supabase.storage
        .from('building-photos')
        .upload(path, bytes, { contentType: 'image/jpeg' });

      if (uploadError) {
        console.error('Upload error:', uploadError.message);
        Alert.alert('Upload Failed', uploadError.message);
        return;
      }

      // Insert photo record
      const { error: insertError } = await supabase
        .from('building_photos')
        .insert({
          block_id: block.block_id,
          user_id: user.id,
          storage_path: path,
          photo_type: 'general',
        });

      if (insertError) {
        console.error('Insert error:', insertError.message);
        return;
      }

      loadData(); // Refresh
    } catch (err) {
      console.error('Upload error:', err);
      Alert.alert('Upload Failed', 'Could not upload photo.');
    }
  };

  const submitVerification = async () => {
    if (!user || !block) return;

    const meters = parseFloat(verifyMeters);
    if (isNaN(meters) || meters <= 0) {
      Alert.alert('Invalid', 'Enter a valid height in meters.');
      return;
    }

    // Sanity check: ±20% of HDB estimate
    if (meters < block.est_height_m * 0.8 || meters > block.est_height_m * 1.2) {
      Alert.alert(
        'Seems Off',
        `Your reading (${meters}m) is far from the estimated height (${block.est_height_m}m). Please check your watch and try again.`
      );
      return;
    }

    setVerifySubmitting(true);

    try {
      // Upload watch photo if provided
      let photoUrl: string | null = null;
      if (verifyPhotoBase64) {
        const path = `verifications/${block.block_id}/${user.id}-${Date.now()}.jpg`;
        const bytes = base64ToUint8Array(verifyPhotoBase64);

        const { error: uploadError } = await supabase.storage
          .from('building-photos')
          .upload(path, bytes, { contentType: 'image/jpeg' });

        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('building-photos')
            .getPublicUrl(path);
          photoUrl = urlData.publicUrl;
        }
      }

      // Submit verification
      const { error } = await supabase
        .from('height_verifications')
        .insert({
          block_id: block.block_id,
          user_id: user.id,
          submitted_height_m: meters,
          watch_photo_url: photoUrl,
        });

      if (error) {
        if (error.message?.includes('unique')) {
          Alert.alert('Already Submitted', 'You have already verified this building. Remove your existing submission first.');
        } else if (error.message?.includes('deviat')) {
          Alert.alert('Rejected', error.message);
        } else {
          Alert.alert('Error', error.message);
        }
      } else {
        Alert.alert('Thanks!', 'Your verification has been submitted. The building outline will show progress as more verifiers contribute.');
        setVerifyVisible(false);
        setVerifyMeters('');
        setVerifyPhotoBase64(null);
        loadData();
      }
    } catch (err) {
      Alert.alert('Error', 'Verification submission failed.');
    }

    setVerifySubmitting(false);
  };

  const handleReportPhoto = async (photo: BuildingPhoto) => {
    Alert.alert(
      'Report Photo',
      'Why are you reporting this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Inappropriate', onPress: () => submitReport(photo.photo_id, 'inappropriate') },
        { text: 'Not This Building', onPress: () => submitReport(photo.photo_id, 'wrong_building') },
        { text: 'Spam', onPress: () => submitReport(photo.photo_id, 'spam') },
      ],
    );
  };

  const submitReport = async (photoId: string, _reason: string) => {
    // Increment report_count via RPC or direct update
    const { error } = await supabase.rpc('increment_report_count', { p_photo_id: photoId });
    if (error) {
      console.error('Report error:', error.message);
    } else {
      Alert.alert('Reported', 'Thank you. We will review this photo.');
    }
  };

  const handleRate = async (stars: number) => {
    if (isAnonymous) {
      setPendingAuthAction('rate');
      setAuthPromptVisible(true);
      return;
    }
    if (!user || !block) return;

    setMyRating(stars); // optimistic — don't wait on the round trip to reflect the tap
    const { error } = await supabase
      .from('block_ratings')
      .upsert({ block_id: block.block_id, user_id: user.id, rating: stars }, { onConflict: 'block_id,user_id' });

    if (error) {
      console.error('Rating error:', error.message);
    } else {
      loadData(); // refresh the average
    }
  };

  const handleSubmitComment = async () => {
    if (isAnonymous) {
      setPendingAuthAction('comment');
      setAuthPromptVisible(true);
      return;
    }
    if (!user || !block || !commentText.trim()) return;

    setCommentSubmitting(true);
    const { error } = await supabase
      .from('block_comments')
      .insert({ block_id: block.block_id, user_id: user.id, body: commentText.trim() });
    setCommentSubmitting(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setCommentText('');
      loadData();
    }
  };

  const handleReportComment = (commentId: string) => {
    Alert.alert(
      'Report Comment',
      'Why are you reporting this comment?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Inappropriate', onPress: () => submitCommentReport(commentId) },
        { text: 'Spam', onPress: () => submitCommentReport(commentId) },
      ],
    );
  };

  const submitCommentReport = async (commentId: string) => {
    const { error } = await supabase.rpc('increment_comment_report_count', { p_comment_id: commentId });
    if (error) {
      console.error('Report error:', error.message);
    } else {
      Alert.alert('Reported', 'Thank you. We will review this comment.');
    }
  };

  if (!block) return null;

  const tierColor = getTierColor(block.storeys);
  const verifiedValue = verifications.length > 0 ? verifications[0].submitted_height_m : null;
  const myVerification = user ? verifications.find((v) => v.user_id === user.id) : undefined;

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.overlay}>
          <TouchableOpacity style={styles.backdropArea} activeOpacity={1} onPress={onClose} />
          <KeyboardAvoidingView
            style={styles.sheet}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            {/* Handle */}
            <View style={styles.handle} />

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
              {/* Header: storey count + address */}
              <View style={styles.header}>
                <View style={[styles.storeyCircle, { borderColor: tierColor }]}>
                  <Text style={[styles.storeyNumber, { color: tierColor }]}>{block.storeys}</Text>
                  <Text style={styles.storeyUnit}>floors</Text>
                </View>
                <View style={styles.headerInfo}>
                  <Text style={styles.headerAddr} numberOfLines={2}>
                    Blk {block.blk_no} {block.street}
                  </Text>
                  {block.town && <Text style={styles.headerTown}>{block.town}</Text>}
                  <TouchableOpacity
                    onPress={() => {
                      if (block.lat && block.lng) {
                        Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${block.lat},${block.lng}`);
                      }
                    }}
                    style={styles.directionsLink}
                  >
                    <Ionicons name="navigate-outline" size={14} color="#2563EB" />
                    <Text style={styles.directionsText}>Get Directions</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Rating — right under the header, before anything else */}
              <View style={styles.section}>
                <View style={styles.ratingRow}>
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <TouchableOpacity key={n} onPress={() => handleRate(n)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                        <Ionicons
                          name={n <= myRating ? 'star' : 'star-outline'}
                          size={22}
                          color={n <= myRating ? '#F59E0B' : '#D1D5DB'}
                        />
                      </TouchableOpacity>
                    ))}
                  </View>
                  {ratingSummary.count > 0 ? (
                    <Text style={styles.ratingSummaryText}>
                      {ratingSummary.avg.toFixed(1)} ({ratingSummary.count} climber{ratingSummary.count !== 1 ? 's' : ''})
                    </Text>
                  ) : (
                    <Text style={styles.ratingSummaryText}>No ratings yet</Text>
                  )}
                </View>
              </View>

              {/* Photo gallery */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Photos</Text>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert('Add Photo', '', [
                        { text: 'Take Photo', onPress: () => handleAddPhoto('camera') },
                        { text: 'Choose from Library', onPress: () => handleAddPhoto('library') },
                        { text: 'Cancel', style: 'cancel' },
                      ]);
                    }}
                  >
                    <Ionicons name="add-circle-outline" size={24} color="#2563EB" />
                  </TouchableOpacity>
                </View>

                {photos.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
                    {photos.map((photo) => (
                      <TouchableOpacity
                        key={photo.photo_id}
                        style={styles.photoItem}
                        onLongPress={() => handleReportPhoto(photo)}
                      >
                        <Image
                          source={{ uri: supabase.storage.from('building-photos').getPublicUrl(photo.storage_path).data.publicUrl }}
                          style={styles.photoImg}
                        />
                        <View style={styles.photoTag}>
                          <Text style={styles.photoTagText}>{photo.photo_type}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <View style={styles.photoPlaceholder}>
                    <Ionicons name="images-outline" size={32} color="#D1D5DB" />
                    <Text style={styles.photoPlaceholderText}>No photos yet — be the first to add one</Text>
                  </View>
                )}
              </View>

              {/* Comments — from other climbers, right under the building's details */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Comments</Text>
                <View style={styles.commentInputRow}>
                  <TextInput
                    style={styles.commentInput}
                    placeholder="Share something about this building..."
                    placeholderTextColor="#9CA3AF"
                    value={commentText}
                    onChangeText={setCommentText}
                    multiline
                    maxLength={280}
                  />
                  <TouchableOpacity
                    style={[styles.commentSendBtn, (!commentText.trim() || commentSubmitting) && { opacity: 0.5 }]}
                    onPress={handleSubmitComment}
                    disabled={!commentText.trim() || commentSubmitting}
                  >
                    {commentSubmitting ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Ionicons name="send" size={16} color="#FFF" />
                    )}
                  </TouchableOpacity>
                </View>

                {comments.length > 0 ? (
                  comments.map((c) => (
                    <TouchableOpacity
                      key={c.comment_id}
                      style={styles.commentRow}
                      onLongPress={() => handleReportComment(c.comment_id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.commentAvatar}>
                        <Text style={styles.commentAvatarText}>{(c.user_id ?? '?').slice(0, 1).toUpperCase()}</Text>
                      </View>
                      <View style={styles.commentContent}>
                        <View style={styles.commentMeta}>
                          <Text style={styles.commentUser}>Climber{c.user_id?.slice(0, 4)}</Text>
                          <Text style={styles.commentTime}>{new Date(c.created_at).toLocaleDateString()}</Text>
                        </View>
                        <Text style={styles.commentBody}>{c.body}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No comments yet — be the first to share something.</Text>
                )}
              </View>

              {/* Verification */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Height Verification</Text>

                {verificationStatus === 'estimated' && (
                  <View style={styles.verifyState}>
                    <Text style={styles.verifyHeight}>~{block.est_height_m}m (estimated)</Text>
                    <TouchableOpacity style={styles.verifyActionBtn} onPress={handleVerifyPress}>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.verifyActionText}>Verify Height</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {verificationStatus === 'pending' && (
                  <View style={styles.verifyState}>
                    <Text style={styles.verifyHeight}>~{block.est_height_m}m (estimated)</Text>
                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${(verifications.length / 3) * 100}%` }]} />
                    </View>
                    <Text style={styles.progressText}>
                      {verifications.length} of 3 verifications
                    </Text>
                    {verifications.map((v, i) => (
                      <Text key={i} style={styles.verifierName}>
                        {v.display_name ?? `Climber${v.user_id.slice(0, 4)}`}
                      </Text>
                    ))}
                    <TouchableOpacity style={styles.verifyActionBtn} onPress={handleVerifyPress}>
                      <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
                      <Text style={styles.verifyActionText}>Add Your Verification</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {verificationStatus === 'verified' && (
                  <View style={styles.verifyState}>
                    <View style={styles.verifiedRow}>
                      <Text style={styles.verifyHeight}>{verifiedValue ?? block.est_height_m}m</Text>
                      <View style={styles.verifiedBadge}>
                        <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                        <Text style={styles.verifiedBadgeText}>Verified ✓</Text>
                      </View>
                    </View>
                    {verifications.map((v, i) => (
                      <Text key={i} style={styles.verifierName}>
                        {v.display_name ?? `Climber${v.user_id.slice(0, 4)}`} ✓
                      </Text>
                    ))}
                    <TouchableOpacity style={styles.disputeBtn} onPress={handleVerifyPress}>
                      <Ionicons name="warning-outline" size={16} color="#F59E0B" />
                      <Text style={styles.disputeText}>Dispute</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {verificationStatus === 'disputed' && (
                  <View style={styles.verifyState}>
                    <View style={styles.verifiedRow}>
                      <Text style={styles.verifyHeight}>{verifiedValue ?? block.est_height_m}m</Text>
                      <View style={styles.verifiedBadge}>
                        <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                        <Text style={styles.verifiedBadgeText}>Verified ✓</Text>
                      </View>
                    </View>
                    <Text style={styles.progressText}>
                      {disputeCount} user{disputeCount !== 1 ? 's' : ''} disputing
                    </Text>
                  </View>
                )}

                {/* Shown regardless of overall state, whenever this user has an
                    active submission of their own — "removable by the submitter" */}
                {myVerification && (
                  <TouchableOpacity
                    style={styles.removeVerifyLink}
                    onPress={() => handleRemoveVerification(myVerification.verification_id)}
                  >
                    <Text style={styles.removeVerifyLinkText}>Remove my verification</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Recent climbs */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Climbs</Text>
                {recentClimbs.length > 0 ? (
                  recentClimbs.map((climb, i) => (
                    <View key={i} style={styles.climbRow}>
                      <Text style={styles.climbUser} numberOfLines={1}>
                        Climber{climb.user_id?.slice(0, 4)}
                      </Text>
                      <Text style={styles.climbFloors}>{climb.floors_climbed} floors</Text>
                      <Text style={styles.climbTime}>
                        {new Date(climb.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No climbs logged here yet.</Text>
                )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Verification submission modal */}
      <Modal visible={verifyVisible} transparent animationType="fade" onRequestClose={() => setVerifyVisible(false)}>
        <KeyboardAvoidingView
          style={styles.verifyModalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.verifyModal}>
            <Text style={styles.verifyModalTitle}>Verify Building Height</Text>
            <Text style={styles.verifyModalSub}>
              Enter the elevation gain from your fitness watch for this building. A watch photo is required.
            </Text>

            {/* Meters input */}
            <Text style={styles.inputLabel}>Elevation Gain (meters)</Text>
            <TextInput
              style={styles.metersInput}
              placeholder="e.g. 112"
              placeholderTextColor="#9CA3AF"
              keyboardType="numeric"
              value={verifyMeters}
              onChangeText={setVerifyMeters}
            />

            {/* Watch photo */}
            <TouchableOpacity
              style={styles.photoPickBtn}
              onPress={() => {
                Alert.alert('Add Watch Photo', '', [
                  { text: 'Take Photo', onPress: async () => {
                    const perm = await ImagePicker.requestCameraPermissionsAsync();
                    if (!perm.granted) { Alert.alert('Camera Access', 'Enable camera in Settings.'); return; }
                    const r = await ImagePicker.launchCameraAsync({ quality: 0.8, base64: true });
                    if (!r.canceled && r.assets?.[0]?.base64) setVerifyPhotoBase64(r.assets[0].base64);
                  }},
                  { text: 'Choose from Library', onPress: async () => {
                    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, base64: true });
                    if (!r.canceled && r.assets?.[0]?.base64) setVerifyPhotoBase64(r.assets[0].base64);
                  }},
                  { text: 'Cancel', style: 'cancel' },
                ]);
              }}
            >
              {verifyPhotoBase64 ? (
                <Image source={{ uri: `data:image/jpeg;base64,${verifyPhotoBase64}` }} style={styles.watchPreview} />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={20} color="#6B7280" />
                  <Text style={styles.photoPickText}>Attach Watch Photo</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.verifyModalActions}>
              <TouchableOpacity style={styles.verifyCancelBtn} onPress={() => { setVerifyVisible(false); setVerifyPhotoBase64(null); setVerifyMeters(''); }}>
                <Text style={styles.verifyCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.verifySubmitBtn, verifySubmitting && { opacity: 0.5 }]}
                onPress={submitVerification}
                disabled={verifySubmitting}
              >
                {verifySubmitting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.verifySubmitText}>Submit</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AuthPrompt
        visible={authPromptVisible}
        reason={
          pendingAuthAction === 'verify' ? 'verify building heights' :
          pendingAuthAction === 'rate' ? 'rate this building' :
          pendingAuthAction === 'comment' ? 'comment on this building' :
          'add photos'
        }
        onClose={() => { setAuthPromptVisible(false); setPendingAuthAction(null); }}
        onSuccess={() => {
          setAuthPromptVisible(false);
          if (pendingAuthAction === 'verify') setVerifyVisible(true);
          setPendingAuthAction(null);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'transparent' },
  backdropArea: { height: '15%', backgroundColor: 'transparent' },
  sheet: {
    height: '85%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: '#D1D5DB',
    alignSelf: 'center', marginTop: 10, marginBottom: 0,
  },
  scrollContent: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  storeyCircle: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 3, justifyContent: 'center', alignItems: 'center', marginRight: 16,
  },
  storeyNumber: { fontSize: 24, fontWeight: '800' },
  storeyUnit: { fontSize: 10, color: '#9CA3AF', marginTop: 1 },
  headerInfo: { flex: 1 },
  headerAddr: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 2 },
  headerTown: { fontSize: 13, color: '#6B7280' },
  directionsLink: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  directionsText: { fontSize: 13, color: '#2563EB', fontWeight: '600' },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  starsRow: { flexDirection: 'row', gap: 4 },
  ratingSummaryText: { fontSize: 13, fontWeight: '600', color: '#6B7280' },
  commentInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 14 },
  commentInput: {
    flex: 1, backgroundColor: '#F3F4F6', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 13, color: '#111827', maxHeight: 90,
  },
  commentSendBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: '#2563EB',
    alignItems: 'center', justifyContent: 'center',
  },
  commentRow: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  commentAvatar: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  commentAvatarText: { fontSize: 13, fontWeight: '700', color: '#2563EB' },
  commentContent: { flex: 1 },
  commentMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  commentUser: { fontSize: 12, fontWeight: '700', color: '#374151' },
  commentTime: { fontSize: 11, color: '#9CA3AF' },
  commentBody: { fontSize: 13, color: '#111827', lineHeight: 18 },
  verifyState: { alignItems: 'center', paddingVertical: 12 },
  verifyHeight: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 8 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16,185,129,0.1)', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, gap: 4 },
  verifiedBadgeText: { fontSize: 12, fontWeight: '700', color: '#10B981' },
  progressBar: { height: 6, backgroundColor: '#E5E7EB', borderRadius: 3, width: '80%', marginBottom: 8, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#2563EB', borderRadius: 3 },
  progressText: { fontSize: 13, color: '#6B7280', fontWeight: '500', marginBottom: 4 },
  verifierName: { fontSize: 12, color: '#9CA3AF', marginBottom: 2 },
  verifyActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2563EB', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, marginTop: 10,
  },
  verifyActionText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  disputeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(245,158,11,0.1)', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 10, marginTop: 10,
  },
  disputeText: { color: '#F59E0B', fontSize: 13, fontWeight: '600' },
  removeVerifyLink: { marginTop: 10, paddingVertical: 4 },
  removeVerifyLinkText: { fontSize: 12, color: '#EF4444', fontWeight: '600', textDecorationLine: 'underline' },
  photoRow: { flexDirection: 'row', paddingBottom: 4 },
  photoItem: { width: 120, height: 120, borderRadius: 10, marginRight: 10, overflow: 'hidden', backgroundColor: '#F3F4F6' },
  photoImg: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6 },
  photoTagText: { fontSize: 10, color: '#FFF', fontWeight: '600' },
  photoPlaceholder: { alignItems: 'center', paddingVertical: 24, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, borderStyle: 'dashed' },
  photoPlaceholderText: { fontSize: 13, color: '#9CA3AF', marginTop: 8 },
  climbRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  climbUser: { flex: 1, fontSize: 13, fontWeight: '500', color: '#374151' },
  climbFloors: { fontSize: 13, fontWeight: '600', color: '#10B981', marginRight: 12 },
  climbTime: { fontSize: 11, color: '#9CA3AF' },
  emptyText: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', paddingVertical: 12 },
  verifyModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  verifyModal: { backgroundColor: '#FFF', borderRadius: 16, padding: 24, width: '85%', maxWidth: 360 },
  verifyModalTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 6 },
  verifyModalSub: { fontSize: 13, color: '#6B7280', lineHeight: 19, marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6 },
  metersInput: {
    backgroundColor: '#F3F4F6', borderRadius: 10, padding: 14, fontSize: 20, fontWeight: '700',
    color: '#111827', textAlign: 'center', marginBottom: 14,
  },
  photoPickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#F3F4F6', borderRadius: 10, padding: 16, marginBottom: 16, minHeight: 80,
  },
  photoPickText: { fontSize: 14, color: '#6B7280', fontWeight: '500' },
  watchPreview: { width: '100%', height: 200, borderRadius: 8, resizeMode: 'cover' },
  verifyModalActions: { flexDirection: 'row', gap: 10 },
  verifyCancelBtn: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' },
  verifyCancelText: { fontWeight: '600', color: '#6B7280', fontSize: 14 },
  verifySubmitBtn: { flex: 2, padding: 14, borderRadius: 12, backgroundColor: '#2563EB', alignItems: 'center' },
  verifySubmitText: { fontWeight: '700', color: '#FFFFFF', fontSize: 14 },
});
