// src/screens/CommunityScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ActivityIndicator, FlatList, TouchableOpacity, Image, RefreshControl, TextInput, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { db, auth } from '../firebaseConfig';
import { collection, query, where, orderBy, limit, startAfter, getDocs, getDoc, doc, runTransaction, increment, updateDoc, arrayUnion, arrayRemove, deleteDoc, getCountFromServer } from 'firebase/firestore';
import * as Haptics from 'expo-haptics';
import { getTier, getTierBounds } from '../ecoTiers';
import { Avatar, Earth } from '../ui/Critters';
import { TierBadge, DifficultyIcon, AwardCoin } from '../ui/Badges';
import Icon from '../ui/Icons';
import { Button, IconButton, Segmented, ScopeChips, Sheet } from '../ui/components';
import { TAB_BAR_SPACE } from '../ui/TabBar';
import { colors, difficultyTheme, fonts, type } from '../ui/theme';

const PAGE_SIZE = 10;
const LEADERBOARD_SIZE = 50;
const FLAG_HIDE_THRESHOLD = 3; // posts reported by this many people are hidden from the feed

// Fixed award values so a gift means the same thing to sender and receiver
// (Perry: common ground). The points are transferred to the post's author.
const AWARDS = [
  { id: 'leaf', name: 'Sprout', cost: 10 },
  { id: 'tree', name: 'Canopy', cost: 25 },
  { id: 'water', name: 'Pure', cost: 50 },
  { id: 'planet', name: 'Earth Keeper', cost: 100 },
];
const MEDAL_BG = { 1: '#D9E58A', 2: colors.seafoam, 3: colors.pistachio };

const usersRef = collection(db, 'Users');

const mapUser = (d) => {
  const dat = d.data();
  return { id: d.id, avatar: dat.avatar || null, displayName: dat.userDisplayName || 'EcoActioner', score: dat.score || 0 };
};

// Standard competition ranking: tied scores share a rank.
const rankList = (list) => {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  let prevScore = null;
  let prevRank = 0;
  return sorted.map((u, i) => {
    const rank = u.score === prevScore ? prevRank : i + 1;
    prevScore = u.score;
    prevRank = rank;
    return { ...u, rank };
  });
};

const formatDate = (d) => {
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
};

export default function CommunityScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState('feed');
  const [feedFilter, setFeedFilter] = useState('global');
  const [rankFilter, setRankFilter] = useState('tier'); // default: compare with people at your own title
  const [following, setFollowing] = useState([]);
  const [me, setMe] = useState(null);
  const [boards, setBoards] = useState({ tier: [], following: [], global: [] });
  const [myRanks, setMyRanks] = useState({ tier: null, following: null, global: null });
  const [feed, setFeed] = useState([]);
  const [followingFeed, setFollowingFeed] = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [postToAward, setPostToAward] = useState(null);
  const [selectedAward, setSelectedAward] = useState('tree');
  const [giftBusy, setGiftBusy] = useState(false);

  const [member, setMember] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastFeedDoc, setLastFeedDoc] = useState(null);
  const [hasMoreFeed, setHasMoreFeed] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Attach each author's current handle, avatar and title. Names always come from the
  // chosen handle, never the email address.
  const hydratePosts = async (docs) => {
    const cache = {};
    const posts = [];
    for (const d of docs) {
      const dat = d.data();
      if (dat.flaggedCount && dat.flaggedCount >= FLAG_HIDE_THRESHOLD) continue;
      if (!(dat.userId in cache)) {
        const a = await getDoc(doc(db, 'Users', dat.userId));
        cache[dat.userId] = a.exists() ? a.data() : {};
      }
      const author = cache[dat.userId];
      posts.push({
        id: d.id,
        ...dat,
        authorName: author.userDisplayName || 'EcoActioner',
        authorAvatar: author.avatar || null,
        authorScore: author.score || 0,
        createdAt: dat.timestamp ? dat.timestamp.toDate() : new Date(),
      });
    }
    return posts;
  };

  const loadLeaderboards = async (myId, myScore, myFollowing) => {
    const { min, max } = getTierBounds(myScore);
    const tierFilters = max !== null ? [where('score', '>=', min), where('score', '<', max)] : [where('score', '>=', min)];
    const tierAboveFilters = max !== null ? [where('score', '>', myScore), where('score', '<', max)] : [where('score', '>', myScore)];

    const [globalSnap, tierSnap, followDocs, globalAbove, tierAbove] = await Promise.all([
      getDocs(query(usersRef, orderBy('score', 'desc'), limit(LEADERBOARD_SIZE))),
      getDocs(query(usersRef, ...tierFilters, orderBy('score', 'desc'), limit(LEADERBOARD_SIZE))),
      Promise.all([myId, ...myFollowing].map(id => getDoc(doc(db, 'Users', id)))),
      getCountFromServer(query(usersRef, where('score', '>', myScore))),
      getCountFromServer(query(usersRef, ...tierAboveFilters)),
    ]);
    const followingBoard = rankList(followDocs.filter(d => d.exists()).map(mapUser));
    setBoards({ global: rankList(globalSnap.docs.map(mapUser)), tier: rankList(tierSnap.docs.map(mapUser)), following: followingBoard });
    // Your own rank comes from the server, so it shows even outside the top 50.
    setMyRanks({
      global: globalAbove.data().count + 1,
      tier: tierAbove.data().count + 1,
      following: followingBoard.find(u => u.id === myId)?.rank || 1,
    });
  };

  const loadData = useCallback(async () => {
    try {
      const currentUser = auth.currentUser;
      let myFollowing = [];
      if (currentUser) {
        const userDoc = await getDoc(doc(db, 'Users', currentUser.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          myFollowing = data.following || [];
          setFollowing(myFollowing);
          setMe({ id: currentUser.uid, displayName: data.userDisplayName || 'EcoActioner', avatar: data.avatar || null, score: data.score || 0 });
          try {
            await loadLeaderboards(currentUser.uid, data.score || 0, myFollowing);
          } catch (e) {
            console.error('Leaderboard error:', e);
          }
        }
      }
      const snapFeed = await getDocs(query(collection(db, 'CommunityPosts'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE)));
      setFeed(await hydratePosts(snapFeed.docs));
      setLastFeedDoc(snapFeed.docs[snapFeed.docs.length - 1] || null);
      setHasMoreFeed(snapFeed.docs.length >= PAGE_SIZE);
    } catch (e) {
      console.error('Community data error:', e);
    }
  }, []);

  useEffect(() => { loadData().then(() => setLoading(false)); }, [loadData]);

  // Posts from people you follow, fetched directly (not just filtered from the latest
  // page). 'in' queries take up to 30 ids, so ids are chunked. Sorting happens here
  // to avoid needing a composite index.
  const loadFollowingFeed = useCallback(async (ids) => {
    if (!ids.length) { setFollowingFeed([]); return; }
    setLoadingFollowing(true);
    try {
      const chunks = [];
      for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
      const snaps = await Promise.all(chunks.map(c => getDocs(query(collection(db, 'CommunityPosts'), where('userId', 'in', c), limit(40)))));
      const docs = snaps.flatMap(sn => sn.docs)
        .sort((a, b) => (b.data().timestamp?.toMillis?.() || 0) - (a.data().timestamp?.toMillis?.() || 0))
        .slice(0, 40);
      setFollowingFeed(await hydratePosts(docs));
    } catch (e) {
      console.error('Following feed error:', e);
    } finally {
      setLoadingFollowing(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'feed' && feedFilter === 'following') loadFollowingFeed(following);
  }, [activeTab, feedFilter, following, loadFollowingFeed]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    if (feedFilter === 'following') await loadFollowingFeed(following);
    setRefreshing(false);
  };

  const handleLoadMore = async () => {
    if (activeTab !== 'feed' || feedFilter !== 'global' || !lastFeedDoc || !hasMoreFeed || loadingMore) return;
    setLoadingMore(true);
    try {
      const snap = await getDocs(query(collection(db, 'CommunityPosts'), orderBy('timestamp', 'desc'), startAfter(lastFeedDoc), limit(PAGE_SIZE)));
      const more = await hydratePosts(snap.docs);
      setFeed(prev => [...prev, ...more]);
      setLastFeedDoc(snap.docs[snap.docs.length - 1] || lastFeedDoc);
      setHasMoreFeed(snap.docs.length >= PAGE_SIZE);
    } catch (e) {
      console.error('Pagination error:', e);
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleFollow = async (targetId) => {
    const user = auth.currentUser;
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isFollowing = following.includes(targetId);
    try {
      await updateDoc(doc(db, 'Users', user.uid), { following: isFollowing ? arrayRemove(targetId) : arrayUnion(targetId) });
      setFollowing(prev => isFollowing ? prev.filter(id => id !== targetId) : [...prev, targetId]);
    } catch (e) {
      console.error('Follow error', e);
    }
  };

  const openMember = async (userId) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const snap = await getDoc(doc(db, 'Users', userId));
      if (!snap.exists()) return;
      const data = snap.data();
      const score = data.score || 0;
      const [above, recentSnap] = await Promise.all([
        getCountFromServer(query(usersRef, where('score', '>', score))),
        getDocs(query(collection(db, 'CommunityPosts'), where('userId', '==', userId), limit(10))),
      ]);
      const recent = recentSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0))
        .slice(0, 3);
      setMember({
        id: userId,
        displayName: data.userDisplayName || 'EcoActioner',
        avatar: data.avatar || null,
        score,
        questsCompletedCount: data.questsCompletedCount || 0,
        rank: above.data().count + 1,
        recent,
      });
    } catch (e) {
      Alert.alert('Error', 'Could not load this profile.');
    }
  };

  const deletePost = (postId) => {
    Alert.alert('Delete post?', 'This removes it from the community feed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteDoc(doc(db, 'CommunityPosts', postId)); handleRefresh(); }
        catch (e) { Alert.alert('Error', 'Could not delete the post.'); }
      } },
    ]);
  };

  const reportPost = (postId) => {
    Alert.alert('Report post?', `Posts reported by ${FLAG_HIDE_THRESHOLD} people are hidden from the feed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: async () => {
        try {
          await updateDoc(doc(db, 'CommunityPosts', postId), { flaggedCount: increment(1) });
          Alert.alert('Reported', 'Thanks. This post has been flagged.');
          handleRefresh();
        } catch (e) { Alert.alert('Error', 'Could not report the post.'); }
      } },
    ]);
  };

  const toggleLike = async (post) => {
    const user = auth.currentUser;
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const liked = post.likedBy?.includes(user.uid);
    // Optimistic update so the heart responds instantly.
    const flip = (list) => list.map(p => p.id !== post.id ? p : {
      ...p,
      likes: (p.likes || 0) + (liked ? -1 : 1),
      likedBy: liked ? (p.likedBy || []).filter(id => id !== user.uid) : [...(p.likedBy || []), user.uid],
    });
    setFeed(flip);
    setFollowingFeed(flip);
    try {
      await updateDoc(doc(db, 'CommunityPosts', post.id), liked
        ? { likedBy: arrayRemove(user.uid), likes: increment(-1) }
        : { likedBy: arrayUnion(user.uid), likes: increment(1) });
    } catch (e) {
      handleRefresh();
    }
  };

  const openGift = (post) => {
    if (post.userId === auth.currentUser?.uid) return;
    setSelectedAward('tree');
    setPostToAward(post);
  };

  // The sheet is the confirmation step: pick an award, see the balance change, confirm.
  const sendGift = async () => {
    const user = auth.currentUser;
    const award = AWARDS.find(a => a.id === selectedAward);
    if (!user || !postToAward || !award || giftBusy) return;
    setGiftBusy(true);
    try {
      await runTransaction(db, async (t) => {
        const userRef = doc(db, 'Users', user.uid);
        const recipientRef = doc(db, 'Users', postToAward.userId);
        const postRef = doc(db, 'CommunityPosts', postToAward.id);
        const userDoc = await t.get(userRef);
        const recipientDoc = await t.get(recipientRef);
        if (!recipientDoc.exists()) throw new Error('NO_RECIPIENT');
        const cur = userDoc.data().score || 0;
        if (cur < award.cost) throw new Error('LOW_FUNDS');
        t.update(userRef, { score: cur - award.cost });
        t.update(recipientRef, {
          score: (recipientDoc.data().score || 0) + award.cost,
          giftPointsReceived: (recipientDoc.data().giftPointsReceived || 0) + award.cost,
        });
        t.update(postRef, { [`awards.${award.id}`]: increment(1) });
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPostToAward(null);
      handleRefresh();
    } catch (e) {
      if (e.message === 'LOW_FUNDS') Alert.alert('Not enough points', `This award needs ${award.cost} points.`);
      else if (e.message === 'NO_RECIPIENT') Alert.alert('Unavailable', 'This person no longer has an account.');
      else Alert.alert('Error', 'Could not send the award.');
    } finally {
      setGiftBusy(false);
    }
  };

  // ---------- derived ----------
  const myId = auth.currentUser?.uid;
  const myScore = me?.score || 0;
  const myTier = getTier(myScore);
  const { min: tierMin, max: tierMax } = getTierBounds(myScore);
  const board = boards[rankFilter] || [];
  const nextAbove = [...board].filter(u => u.score > myScore).sort((a, b) => a.score - b.score)[0];

  const displayData = activeTab === 'feed'
    ? (feedFilter === 'global' ? feed : followingFeed)
    : (searchQuery ? board.filter(u => u.displayName.toLowerCase().includes(searchQuery.toLowerCase())) : board);

  const leagueTitle = rankFilter === 'tier' ? `${myTier.title} league` : rankFilter === 'following' ? 'You + people you follow' : 'Everyone';
  const leagueSub = rankFilter === 'tier'
    ? (tierMax !== null ? `Everyone with ${tierMin} to ${tierMax - 1} points` : `Everyone with ${tierMin}+ points`)
    : rankFilter === 'following' ? `${following.length} people followed` : 'All Eco Quest members';

  // ---------- renderers ----------
  const renderHeader = () => (
    <View style={{ gap: 14, marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.h1, { fontSize: 34 }]} accessibilityRole="header">Community</Text>
        <Earth size={46} />
      </View>
      <Segmented options={[{ key: 'feed', label: 'Posts' }, { key: 'leaderboard', label: 'Rankings' }]} value={activeTab} onChange={(k) => { setActiveTab(k); setSearchQuery(''); }} />
      {activeTab === 'feed'
        ? <ScopeChips options={[{ key: 'global', label: 'Global' }, { key: 'following', label: 'Following' }]} value={feedFilter} onChange={setFeedFilter} />
        : <ScopeChips options={[{ key: 'tier', label: 'My Title' }, { key: 'following', label: 'Following' }, { key: 'global', label: 'Global' }]} value={rankFilter} onChange={setRankFilter} />}

      {activeTab === 'leaderboard' && me && (
        <>
          <View style={{ backgroundColor: colors.sage, borderRadius: 26, padding: 16, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {rankFilter === 'tier' ? <TierBadge tierKey={myTier.key} size={36} /> : <Icon name={rankFilter === 'following' ? 'people' : 'leaf'} size={30} />}
              <View style={{ flex: 1 }}>
                <Text style={type.h2}>{leagueTitle}</Text>
                <Text style={[type.small, { marginTop: 2 }]}>{leagueSub}</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => openMember(me.id)}
              accessibilityRole="button"
              accessibilityLabel={`Your rank: number ${myRanks[rankFilter] || '-'}, ${myScore} points${nextAbove ? `, ${nextAbove.score - myScore + 1} points to pass ${nextAbove.displayName}` : ''}`}
              style={{ backgroundColor: colors.ink, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            >
              <Text style={{ fontFamily: fonts.display, fontSize: 26, color: colors.white }}>#{myRanks[rankFilter] || '–'}</Text>
              <Avatar avatarKey={me.avatar} seed={me.id} size={44} bg={colors.mint} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.white }}>You · {myScore} pts</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.onInkMuted, marginTop: 2 }}>
                  {nextAbove ? `${nextAbove.score - myScore + 1} pts to pass ${nextAbove.displayName}` : 'Top of this list'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, borderRadius: 25, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: 16 }}>
            <Icon name="search" size={20} color={colors.muted} />
            <TextInput
              style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink }}
              placeholder={`Search ${rankFilter === 'tier' ? myTier.title : ''} members`.replace('  ', ' ')}
              placeholderTextColor={colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              accessibilityLabel="Search members in this ranking"
            />
          </View>
        </>
      )}
    </View>
  );

  const renderLeaderRow = (item) => {
    const isMe = item.id === myId;
    const isFollowing = following.includes(item.id);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 18, backgroundColor: isMe ? colors.mint : colors.white, marginBottom: 4 }}>
        <TouchableOpacity
          onPress={() => openMember(item.id)}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}
          accessibilityRole="button"
          accessibilityLabel={`Rank ${item.rank}, ${item.displayName}${isMe ? ' (you)' : ''}, ${getTier(item.score).title}, ${item.score} points`}
        >
          {MEDAL_BG[item.rank]
            ? <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: MEDAL_BG[item.rank], alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: fonts.display, fontSize: 15, color: colors.ink }}>{item.rank}</Text></View>
            : <Text style={{ width: 34, textAlign: 'center', fontFamily: fonts.display, fontSize: 15, color: colors.muted }}>{item.rank}</Text>}
          <Avatar avatarKey={item.avatar} seed={item.id} size={38} />
          <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, color: colors.ink }} numberOfLines={1}>{item.displayName}</Text>
          <Text style={type.label}>{item.score}</Text>
        </TouchableOpacity>
        {isMe ? (
          <View style={{ minWidth: 76, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, backgroundColor: colors.ink }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.white }}>You</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => toggleFollow(item.id)}
            accessibilityRole="button"
            accessibilityLabel={isFollowing ? `Unfollow ${item.displayName}` : `Follow ${item.displayName}`}
            accessibilityState={{ selected: isFollowing }}
            style={{ minWidth: 86, minHeight: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1.5, borderColor: colors.ink, backgroundColor: isFollowing ? colors.ink : colors.white, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: isFollowing ? colors.white : colors.ink }}>{isFollowing ? 'Following' : 'Follow'}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderPost = (item) => {
    const isMine = item.userId === myId;
    const liked = item.likedBy?.includes(myId);
    const theme = difficultyTheme[item.dareDifficulty] || difficultyTheme.Medium;
    const authorTier = getTier(item.authorScore);
    const awards = Object.entries(item.awards || {}).filter(([, c]) => c > 0);
    return (
      <View style={{ backgroundColor: colors.white, borderRadius: 28, paddingTop: 12, borderWidth: 1.5, borderColor: colors.line, marginBottom: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingRight: 8 }}>
          <TouchableOpacity
            onPress={() => openMember(item.userId)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, marginRight: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.authorName}'s profile, ${authorTier.title}`}
          >
            <Avatar avatarKey={item.authorAvatar} seed={item.userId} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink }} numberOfLines={1}>{item.authorName}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
                <TierBadge tierKey={authorTier.key} size={13} />
                <Text style={type.small}>{authorTier.title} · {formatDate(item.createdAt)}</Text>
              </View>
            </View>
          </TouchableOpacity>
          {isMine
            ? <IconButton name="trash" label="Delete your post" onPress={() => deletePost(item.id)} bg="transparent" size={44} iconSize={20} />
            : <IconButton name="flag" label="Report this post" onPress={() => reportPost(item.id)} bg="transparent" color={colors.muted} size={44} iconSize={20} />}
        </View>

        <View style={{ marginTop: 8, marginHorizontal: 16, marginBottom: 12, backgroundColor: theme.bg, borderRadius: 18, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <DifficultyIcon level={item.dareDifficulty} size={14} />
            <Text style={type.eyebrow}>{theme.label}</Text>
          </View>
          <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink, marginTop: 3 }}>{item.dareTitle}</Text>
          {item.dareDescription ? <Text style={[type.small, { marginTop: 2 }]}>{item.dareDescription}</Text> : null}
        </View>

        {item.imageURL ? (
          <Image source={{ uri: item.imageURL }} style={{ marginHorizontal: 16, marginBottom: 12, aspectRatio: 1, borderRadius: 22, backgroundColor: colors.sage }} resizeMode="cover" accessibilityLabel={`Photo shared by ${item.authorName}`} />
        ) : null}

        {item.userCaption ? (
          <Text style={[type.body, { marginHorizontal: 16, marginBottom: 12 }]}>
            <Text style={{ fontFamily: fonts.bold }}>{item.authorName} </Text>{item.userCaption}
          </Text>
        ) : null}

        {awards.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
            {awards.map(([id, count]) => {
              const def = AWARDS.find(a => a.id === id);
              if (!def) return null;
              return (
                <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.ground, borderRadius: 16, paddingVertical: 4, paddingLeft: 4, paddingRight: 10 }}
                  accessible accessibilityLabel={`${count} ${def.name} award${count > 1 ? 's' : ''}`}>
                  <AwardCoin awardId={id} size={26} />
                  <Text style={[type.label, { fontSize: 13 }]}>{def.name} ×{count}</Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 10, paddingTop: 6, paddingBottom: 10, borderTopWidth: 1.5, borderTopColor: '#EEF2EF' }}>
          <TouchableOpacity
            onPress={() => toggleLike(item)}
            accessibilityRole="button"
            accessibilityLabel={`${liked ? 'Unlike' : 'Like'} post, ${item.likes || 0} likes`}
            accessibilityState={{ selected: !!liked }}
            style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: liked ? colors.mint : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="heart" size={20} filled={!!liked} />
            <Text style={type.label}>{item.likes || 0}</Text>
          </TouchableOpacity>
          {!isMine && (
            <TouchableOpacity
              onPress={() => openGift(item)}
              accessibilityRole="button"
              accessibilityLabel={`Send ${item.authorName} an award`}
              style={{ minHeight: 44, paddingHorizontal: 12, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Icon name="gift" size={20} />
              <Text style={type.label}>Award</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  const award = AWARDS.find(a => a.id === selectedAward);
  const memberTier = member ? getTier(member.score) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      {loading ? (
        <ActivityIndicator size="large" color={colors.ink} style={{ marginTop: insets.top + 80 }} />
      ) : (
        <FlatList
          data={displayData}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 20, paddingBottom: TAB_BAR_SPACE + insets.bottom }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.ink} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={renderHeader()}
          ListFooterComponent={(loadingMore || loadingFollowing) ? <ActivityIndicator color={colors.ink} style={{ marginVertical: 15 }} /> : null}
          ListEmptyComponent={
            <Text style={[type.bodyMuted, { textAlign: 'center', marginTop: 30, paddingHorizontal: 20 }]}>
              {(activeTab === 'feed' ? feedFilter : rankFilter) === 'following'
                ? "You aren't following anyone yet. Find people in Rankings."
                : 'Nothing here yet.'}
            </Text>
          }
          renderItem={({ item }) => (activeTab === 'leaderboard' ? renderLeaderRow(item) : renderPost(item))}
        />
      )}

      {/* AWARD SHEET */}
      <Sheet visible={!!postToAward} onClose={() => !giftBusy && setPostToAward(null)} labelledBy="Send an award">
        {postToAward && award && (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar avatarKey={postToAward.authorAvatar} seed={postToAward.userId} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={[type.h2, { fontSize: 24 }]} accessibilityRole="header">Cheer on {postToAward.authorName}</Text>
                <Text style={[type.bodyMuted, { marginTop: 3 }]}>The points go from your balance to theirs.</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }} accessibilityRole="radiogroup">
              {AWARDS.map(a => {
                const on = a.id === selectedAward;
                const affordable = myScore >= a.cost;
                return (
                  <TouchableOpacity
                    key={a.id}
                    onPress={() => setSelectedAward(a.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on, disabled: !affordable }}
                    accessibilityLabel={`${a.name} award, gives ${a.cost} points${affordable ? '' : ', not enough points'}`}
                    style={{ width: '48%', alignItems: 'center', gap: 6, paddingVertical: 16, borderRadius: 22, backgroundColor: on ? colors.white : colors.ground, borderWidth: on ? 2.5 : 2, borderColor: on ? colors.ink : 'transparent', opacity: affordable ? 1 : 0.5 }}
                  >
                    {on && <View style={{ position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><Icon name="check" size={14} color={colors.white} strokeWidth={3} /></View>}
                    <AwardCoin awardId={a.id} size={60} />
                    <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink }}>{a.name}</Text>
                    <Text style={type.bodyMuted}>{a.cost} pts</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.cream, borderRadius: 16, padding: 12 }}>
              <Text style={[type.body, { fontSize: 14 }]}>Your balance</Text>
              <Text style={[type.label]}>{myScore} → {Math.max(0, myScore - award.cost)} pts</Text>
            </View>
            <Button label={`Send ${award.name} · ${award.cost} pts`} onPress={sendGift} loading={giftBusy} disabled={myScore < award.cost} />
            <Button label="Cancel" variant="outline" onPress={() => setPostToAward(null)} disabled={giftBusy} style={{ borderWidth: 0 }} />
          </>
        )}
      </Sheet>

      {/* MEMBER SHEET */}
      <Sheet visible={!!member} onClose={() => setMember(null)} labelledBy="Member profile">
        {member && (
          <>
            <View style={{ alignItems: 'center', gap: 8 }}>
              <Avatar avatarKey={member.avatar} seed={member.id} size={104} />
              <Text style={[type.h1, { fontSize: 28 }]} accessibilityRole="header">{member.displayName}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.seafoam, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }}>
                <TierBadge tierKey={memberTier.key} size={16} />
                <Text style={type.label}>{memberTier.title}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[[member.score, 'Points'], [member.questsCompletedCount, 'Actions'], [`#${member.rank}`, 'Global']].map(([v, l]) => (
                <View key={l} style={{ flex: 1, backgroundColor: colors.ground, borderRadius: 18, paddingVertical: 12, alignItems: 'center' }} accessible accessibilityLabel={`${l}: ${v}`}>
                  <Text style={{ fontFamily: fonts.display, fontSize: 24, color: colors.ink }}>{v}</Text>
                  <Text style={[type.small, { fontFamily: fonts.bold }]}>{l}</Text>
                </View>
              ))}
            </View>
            {member.recent.length > 0 && (
              <View>
                <Text style={[type.eyebrow, { fontSize: 13, marginBottom: 4 }]}>RECENT ACTIONS</Text>
                {member.recent.map(p => (
                  <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1.5, borderTopColor: '#EEF2EF' }}>
                    <DifficultyIcon level={p.dareDifficulty} size={18} />
                    <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 15, color: colors.ink }}>{p.dareTitle}</Text>
                    <Text style={type.small}>{p.timestamp?.toDate ? formatDate(p.timestamp.toDate()) : ''}</Text>
                  </View>
                ))}
              </View>
            )}
            {member.id !== myId && (
              <Button
                label={following.includes(member.id) ? 'Following' : `Follow ${member.displayName}`}
                variant={following.includes(member.id) ? 'outline' : 'primary'}
                onPress={() => toggleFollow(member.id)}
              />
            )}
            <Button label="Close" variant="outline" onPress={() => setMember(null)} style={{ borderWidth: 0 }} />
          </>
        )}
      </Sheet>
    </View>
  );
}
