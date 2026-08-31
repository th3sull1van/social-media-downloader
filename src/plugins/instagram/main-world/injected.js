/**
 * Social Media Downloader — Instagram Main World Injected Script
 * Runs in the PAGE execution context to query Polaris GraphQL and harvest tokens.
 */

(function () {
  'use strict';

  if (typeof window !== 'undefined' && window.top && window !== window.top) return;
  if (window.__SMD_IG_INJECTED__) return;
  window.__SMD_IG_INJECTED__ = true;

  // Verified GraphQL Doc IDs from Instagram Web / Relay
  const DOC_IDS = {
    IG_ProfilePageContent: '28191674790485375',
    IG_ProfilePosts: '26519258537772635',
    IG_ProfilePostsTabContent_connection: '27672504985785333',
    IG_ProfileStoryHighlightsTray: '26970053832668570'
  };

  const session = {
    fb_dtsg: null,
    jazoest: null,
    userId: null,
    csrfToken: null,
    lsd: null,
    appId: '936619743392459',
    asbdId: '359341'
  };

  let isScanCancelled = false;

  function calculateJazoest(dtsg) {
    if (!dtsg) return null;
    let sum = 0;
    for (let i = 0; i < dtsg.length; i++) sum += dtsg.charCodeAt(i);
    return '2' + sum;
  }

  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  function refreshSessionTokens() {
    session.csrfToken = getCookie('csrftoken') || session.csrfToken;
    session.userId = getCookie('ds_user_id') || session.userId;

    if (typeof window.require === 'function') {
      try {
        const dtsgInitial = window.require('DTSGInitialData');
        if (dtsgInitial?.token) session.fb_dtsg = dtsgInitial.token;
      } catch (e) {}

      try {
        const dtsg = window.require('DTSG');
        if (dtsg && typeof dtsg.getToken === 'function') session.fb_dtsg = dtsg.getToken() || session.fb_dtsg;
      } catch (e) {}

      try {
        const lsdModule = window.require('LSD');
        if (lsdModule?.token) session.lsd = lsdModule.token;
      } catch (e) {}

      try {
        const currentUser = window.require('CurrentUserInitialData');
        if (currentUser?.USER_ID && currentUser.USER_ID !== '0') session.userId = currentUser.USER_ID;
      } catch (e) {}
    }

    if (window._sharedData?.config) {
      session.csrfToken = window._sharedData.config.csrf_token || session.csrfToken;
      session.userId = window._sharedData.config.viewerId || session.userId;
      if (window._sharedData.config.lsd) session.lsd = window._sharedData.config.lsd;
    }

    if (!session.fb_dtsg) {
      const dtsgInput = document.querySelector('input[name="fb_dtsg"]');
      if (dtsgInput?.value) session.fb_dtsg = dtsgInput.value;
    }

    if (!session.lsd) {
      const lsdInput = document.querySelector('input[name="lsd"]');
      if (lsdInput?.value) session.lsd = lsdInput.value;
    }

    if (!session.fb_dtsg || !session.lsd) {
      const scripts = document.querySelectorAll('script:not([src])');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (!session.fb_dtsg) {
          const m = text.match(/\["DTSGInitialData",\[\],\{"token":"([^"]+)"\}/) ||
                    text.match(/"token":"(NAf[A-Za-z0-9_\-:]+)"/);
          if (m && m[1]) session.fb_dtsg = m[1];
        }
        if (!session.lsd) {
          const mLsd = text.match(/"LSD",\[\],\{"token":"([^"]+)"\}/) ||
                       text.match(/"lsd":"([^"]+)"/);
          if (mLsd && mLsd[1]) session.lsd = mLsd[1];
        }
      }
    }

    if (session.fb_dtsg) {
      session.jazoest = calculateJazoest(session.fb_dtsg);
    }
  }

  refreshSessionTokens();

  async function performGraphQLQuery(docId, friendlyName, variables, retries = 2) {
    refreshSessionTokens();
    const params = new URLSearchParams();
    params.append('doc_id', docId);
    params.append('variables', typeof variables === 'string' ? variables : JSON.stringify(variables));
    if (friendlyName) params.append('fb_api_req_friendly_name', friendlyName);
    params.append('fb_api_caller_class', 'RelayModern');
    params.append('server_timestamps', 'true');
    params.append('__a', '1');
    params.append('__d', 'www');
    params.append('__comet_req', '7');
    if (session.fb_dtsg) params.append('fb_dtsg', session.fb_dtsg);
    if (session.jazoest) params.append('jazoest', session.jazoest);
    if (session.lsd) params.append('lsd', session.lsd);
    if (session.userId) params.append('av', session.userId);

    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'X-IG-App-ID': session.appId,
      'X-ASBD-ID': session.asbdId
    };
    if (friendlyName) headers['X-FB-Friendly-Name'] = friendlyName;
    if (session.csrfToken) headers['X-CSRFToken'] = session.csrfToken;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch('https://www.instagram.com/graphql/query', {
          method: 'POST',
          headers,
          body: params.toString(),
          credentials: 'include'
        });

        if (response.ok) {
          return await response.json();
        }

        console.warn(`[SMD IG Injected] Query ${friendlyName} returned HTTP ${response.status} on attempt ${attempt + 1}.`);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
          refreshSessionTokens();
        } else {
          throw new Error(`GraphQL request failed: HTTP ${response.status}`);
        }
      } catch (e) {
        console.warn(`[SMD IG Injected] Query ${friendlyName} exception on attempt ${attempt + 1}:`, e);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
          refreshSessionTokens();
        } else {
          throw e;
        }
      }
    }
  }

  async function fetchProfile(username) {
    refreshSessionTokens();

    let targetUserId = null;
    let fallbackInfo = null;

    // Step 1: Query web_profile_info to retrieve target numeric user ID and basic metadata
    try {
      const restUrl = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
      const headers = {
        'X-IG-App-ID': session.appId,
        'X-ASBD-ID': session.asbdId,
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (session.csrfToken) headers['X-CSRFToken'] = session.csrfToken;

      const res = await fetch(restUrl, { headers, credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const user = json.data?.user;
        if (user) {
          targetUserId = String(user.id || user.fbid_v2 || user.pk || '');
          const hdPic = user.hd_profile_pic_url_info?.url || user.profile_pic_url_hd || user.profile_pic_url;
          fallbackInfo = {
            id: targetUserId,
            pk: targetUserId,
            username: user.username || username,
            fullName: user.full_name,
            profilePicUrl: user.profile_pic_url,
            hdProfilePicUrl: hdPic,
            mediaCount: user.edge_owner_to_timeline_media?.count || 0,
            followerCount: user.edge_followed_by?.count || 0
          };
          console.log(`[SMD IG Injected] Target numeric user ID resolved: ${targetUserId}`);
        }
      }
    } catch (e) {
      console.warn('[SMD IG Injected] web_profile_info error:', e);
    }

    // Step 2: Query PolarisProfilePageContentQuery using target's numeric ID to extract true 1080x1080 uncropped avatar
    if (targetUserId) {
      try {
        const variables = {
          enable_integrity_filters: true,
          id: targetUserId,
          __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
          __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
          __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
          __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: true,
          __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false
        };
        const json = await performGraphQLQuery(DOC_IDS.IG_ProfilePageContent, 'PolarisProfilePageContentQuery', variables);
        const user = json.data?.user;
        if (user?.hd_profile_pic_url_info?.url) {
          console.log(`[SMD IG Injected] True 1080x1080 HD profile picture obtained:`, user.hd_profile_pic_url_info.url);
          return {
            ...(fallbackInfo || {}),
            id: targetUserId,
            pk: targetUserId,
            username: user.username || username,
            fullName: user.full_name || fallbackInfo?.fullName,
            hdProfilePicUrl: user.hd_profile_pic_url_info.url,
            profilePicUrl: user.profile_pic_url || fallbackInfo?.profilePicUrl
          };
        }
      } catch (e) {
        console.warn('[SMD IG Injected] PolarisProfilePageContentQuery fallback:', e);
      }
    }

    // Step 3: Check inline DOM scripts for 1080p avatar
    try {
      const scripts = document.querySelectorAll('script:not([src])');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (text.includes('hd_profile_pic_url_info') && text.includes('1080')) {
          const m = text.match(/"hd_profile_pic_url_info":\{"url":"([^"]+)"/);
          if (m && m[1]) {
            const rawHdUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            console.log('[SMD IG Injected] 1080p avatar harvested from inline script:', rawHdUrl);
            return {
              ...(fallbackInfo || { username, id: targetUserId || 'profile' }),
              hdProfilePicUrl: rawHdUrl
            };
          }
        }
      }
    } catch (e) {}

    if (fallbackInfo) return fallbackInfo;
    return { username, hdProfilePicUrl: null };
  }

  async function fetchAllPosts(username, maxCount = 5000, onBatch = null) {
    isScanCancelled = false;
    const allRawNodes = [];
    let endCursor = null;
    let hasNextPage = true;
    let pageCount = 0;
    let pageSize = 33;
    const FALLBACK_PAGE_SIZE = 12;

    console.log(`[SMD IG Injected] Starting paginated post scan for @${username}...`);

    while (hasNextPage && allRawNodes.length < maxCount && !isScanCancelled) {
      pageCount++;
      let queryRes = null;

      if (pageCount === 1) {
        const variables = {
          data: {
            count: pageSize,
            include_reel_media_seen_timestamp: true,
            include_relationship_info: true,
            latest_besties_reel_media: true,
            latest_reel_media: true
          },
          username,
          __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
          __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
          __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false
        };
        try {
          queryRes = await performGraphQLQuery(DOC_IDS.IG_ProfilePosts, 'PolarisProfilePostsQuery', variables);
        } catch (e) {
          console.warn(`[SMD IG Injected] Page 1 query error:`, e);
          // Fallback to connection query if initial query fails
          try {
            const connVars = {
              after: null,
              before: null,
              data: {
                count: FALLBACK_PAGE_SIZE,
                include_reel_media_seen_timestamp: true,
                include_relationship_info: true,
                latest_besties_reel_media: true,
                latest_reel_media: true
              },
              first: FALLBACK_PAGE_SIZE,
              include_multi_captions: true,
              last: null,
              username,
              __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
              __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
              __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false
            };
            queryRes = await performGraphQLQuery(DOC_IDS.IG_ProfilePostsTabContent_connection, 'PolarisProfilePostsTabContentQuery_connection', connVars);
          } catch (e2) {
            console.error('[SMD IG Injected] Page 1 connection fallback also failed:', e2);
            break;
          }
        }
      } else {
        const variables = {
          after: endCursor,
          before: null,
          data: {
            count: pageSize,
            include_reel_media_seen_timestamp: true,
            include_relationship_info: true,
            latest_besties_reel_media: true,
            latest_reel_media: true
          },
          first: pageSize,
          include_multi_captions: true,
          last: null,
          username,
          __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
          __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: false,
          __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false
        };
        try {
          queryRes = await performGraphQLQuery(DOC_IDS.IG_ProfilePostsTabContent_connection, 'PolarisProfilePostsTabContentQuery_connection', variables);
        } catch (e) {
          console.error(`[SMD IG Injected] Page ${pageCount} query error:`, e);
          break;
        }
      }

      const timeline = queryRes?.data?.xdt_api__v1__feed__user_timeline_graphql_connection ||
                       queryRes?.data?.user?.edge_owner_to_timeline_media;

      if (!timeline || !Array.isArray(timeline.edges)) {
        console.warn('[SMD IG Injected] No timeline edges found in response:', queryRes);
        break;
      }

      const pageEdges = timeline.edges;
      const batchNodes = [];
      for (const edge of pageEdges) {
        const node = edge.node || edge;
        allRawNodes.push(node);
        batchNodes.push(node);
      }

      console.log(`[SMD IG Injected] Page ${pageCount} parsed ${batchNodes.length} nodes (Total so far: ${allRawNodes.length}).`);

      if (typeof onBatch === 'function' && batchNodes.length > 0) {
        onBatch(batchNodes, allRawNodes.length);
      }

      const pageInfo = timeline.page_info;
      if (pageInfo && pageInfo.has_next_page && pageInfo.end_cursor) {
        endCursor = pageInfo.end_cursor;
        hasNextPage = true;
        if (pageEdges.length < pageSize && pageSize !== FALLBACK_PAGE_SIZE) {
          pageSize = FALLBACK_PAGE_SIZE;
        }
        await new Promise(r => setTimeout(r, 450));
      } else {
        console.info('[SMD IG Injected] Reached last page of timeline posts.');
        hasNextPage = false;
      }
    }

    return allRawNodes;
  }

  async function fetchStories(userId) {
    if (!userId) return [];
    refreshSessionTokens();

    try {
      const url = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(userId)}`;
      const headers = {
        'X-IG-App-ID': session.appId,
        'X-ASBD-ID': session.asbdId,
        'X-Requested-With': 'XMLHttpRequest'
      };
      if (session.csrfToken) headers['X-CSRFToken'] = session.csrfToken;

      const res = await fetch(url, { headers, credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        const reels = json.reels || (json.data && json.data.reels);
        const userReel = reels && reels[userId];
        if (userReel && Array.isArray(userReel.items)) {
          console.info(`[SMD IG Injected] Found ${userReel.items.length} active stories.`);
          return userReel.items;
        }
      }
    } catch (e) {
      console.warn('[SMD IG Injected] Error fetching stories:', e);
    }
    return [];
  }

  async function fetchHighlights(userId, onBatch = null) {
    if (!userId) return [];
    refreshSessionTokens();

    const allHighlightItems = [];
    try {
      // 1. Fetch highlight tray container via GraphQL
      const variables = { user_id: userId };
      const trayRes = await performGraphQLQuery(
        DOC_IDS.IG_ProfileStoryHighlightsTray,
        'PolarisProfileStoryHighlightsTrayContentQuery',
        variables
      );

      const highlightsData = trayRes.data?.highlights;
      const edges = highlightsData?.edges || [];

      if (!edges.length) {
        console.info('[SMD IG Injected] No highlight albums found.');
        return [];
      }

      console.info(`[SMD IG Injected] Found ${edges.length} highlight albums.`);

      const highlightIds = edges.map(e => e.node?.id).filter(Boolean);
      const titleFor = (hId) => {
        const matchingEdge = edges.find(e => e.node?.id === hId);
        return (matchingEdge?.node?.title) || 'Destaques';
      };

      // 2. Query reels_media in batches of 10
      const BATCH_SIZE = 10;
      for (let i = 0; i < highlightIds.length; i += BATCH_SIZE) {
        if (isScanCancelled) break;
        const batchIds = highlightIds.slice(i, i + BATCH_SIZE);

        let reelsById = null;
        try {
          const url = `https://www.instagram.com/api/v1/feed/reels_media/?reel_ids=${encodeURIComponent(batchIds.join(','))}`;
          const headers = {
            'X-IG-App-ID': session.appId,
            'X-ASBD-ID': session.asbdId,
            'X-Requested-With': 'XMLHttpRequest'
          };
          if (session.csrfToken) headers['X-CSRFToken'] = session.csrfToken;

          const res = await fetch(url, { headers, credentials: 'include' });
          if (res.ok) {
            const json = await res.json();
            reelsById = json.reels || (json.data && json.data.reels) || null;
          }
        } catch (err) {
          console.warn('[SMD IG Injected] Batched reels_media failed:', err);
        }

        if (reelsById && Object.keys(reelsById).length > 0) {
          const batchItems = [];
          for (const hId of batchIds) {
            const reel = reelsById[hId];
            if (!reel || !Array.isArray(reel.items)) continue;
            const highlightTitle = reel.title || titleFor(hId);
            for (const it of reel.items) {
              it._highlightTitle = highlightTitle;
              allHighlightItems.push(it);
              batchItems.push(it);
            }
          }
          if (typeof onBatch === 'function' && batchItems.length > 0) {
            onBatch(batchItems, allHighlightItems.length);
          }
        }
        await new Promise(r => setTimeout(r, 250));
      }
    } catch (e) {
      console.warn('[SMD IG Injected] Error fetching highlights:', e);
    }

    return allHighlightItems;
  }

  // Communication listener with Content Script
  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'SMD_CONTENT') return;
    const { type, requestId, payload } = event.data;
    // Echo the session nonce back: the content script drops responses without it (F-14).
    const nonce = event.data.nonce;

    const reply = (res) => {
      window.postMessage({
        source: 'SMD_IG_INJECTED_RESPONSE',
        nonce,
        requestId,
        ...res
      }, '*');
    };

    const postBatch = (source, payloadData) => {
      window.postMessage({ source, nonce, payload: payloadData }, '*');
    };

    switch (type) {
      case 'PING': {
        reply({ success: true });
        break;
      }
      case 'FETCH_IG_PROFILE': {
        const profile = await fetchProfile(payload?.username);
        reply({ success: true, payload: { profile } });
        break;
      }
      case 'FETCH_IG_POSTS': {
        const nodes = await fetchAllPosts(payload?.username, payload?.maxCount || 5000, (batch) => {
          postBatch('SMD_IG_BATCH_POSTS', { nodes: batch });
        });
        reply({ success: true, payload: { nodes } });
        break;
      }
      case 'FETCH_IG_STORIES': {
        const items = await fetchStories(payload?.userId);
        reply({ success: true, payload: { items } });
        break;
      }
      case 'FETCH_IG_HIGHLIGHTS': {
        const items = await fetchHighlights(payload?.userId, (batch) => {
          postBatch('SMD_IG_BATCH_HIGHLIGHTS', { items: batch });
        });
        reply({ success: true, payload: { items } });
        break;
      }
      case 'CANCEL_SCAN': {
        isScanCancelled = true;
        reply({ success: true });
        break;
      }
      default:
        break;
    }
  });
})();
