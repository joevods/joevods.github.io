"use strict";

function* range(start, stop, step) {
    if (typeof stop == 'undefined') {
        // one param defined
        stop = start;
        start = 0;
    }

    if (typeof step == 'undefined') {
        step = 1;
    }

    if ((step > 0 && start >= stop) || (step < 0 && start <= stop)) {
        return;
    }

    for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
        yield i;
    }
}

function binarySearch(ar, el, compare_fn) {
    let lo = 0;
    let hi = ar.length - 1;
    while (lo <= hi) {
        let mid = (hi + lo) >> 1;
        let cmp = compare_fn(el, ar[mid]);
        if (cmp > 0) {
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

async function loadScript(src) {
    let script = document.createElement('script');
    script.src = src;

    let prom = new Promise((resolve, reject) => {
        script.onload = (ev) => resolve(ev);
        script.onerror = (ev) => reject(ev);
    });

    document.head.append(script);
    return prom;
}

async function init_youtube_player(video_id) {
    let player_loaded = new Promise((resolve) => {
        // shitty youtube uses a global callback function
        window.onYouTubeIframeAPIReady = function() {
            console.debug("onYouTubeIframeAPIReady");
            resolve();
        }
    });

    await loadScript('https://www.youtube.com/iframe_api');
    await player_loaded;

    let player = await new Promise((resolve) => {
        let player = new YT.Player('player', {
            videoId: video_id,
            events: {
              'onReady': event => {resolve(event.target)}
            }
        });
    });

    return player;
}

const VideoPlayerType = {
    'YOUTUBE': 'YOUTUBE',
    'PEERTUBE': 'PEERTUBE',
}

class VideoPlayer {
    constructor(player_obj, get_time) {
        this.player = player_obj;

        // set by the type of player, called by user
        this.getCurrentTime = get_time;

        // set by the user
        this.onPlayerGo = () => {console.debug('forgot to replace go callback')};
        this.onPlayerStop = () => {console.debug('forgot to replace stop callback')};
    }

    static async build(type, player_data) {
        if (type == VideoPlayerType.YOUTUBE) {
            // init player
            let player_obj = await VideoPlayer.init_youtube_player(player_data);

            // create wrapper
            let get_time = () => player_obj.getCurrentTime();
            let player_wrapper = new VideoPlayer(player_obj, get_time);
            // set state change callback
            player_obj.addEventListener('onStateChange', (event) => {
                let playerStatus = event.data;
                switch (playerStatus) {
                    case YT.PlayerState.PLAYING:
                        player_wrapper.onPlayerGo();
                        break;

                    case YT.PlayerState.ENDED:
                    case YT.PlayerState.PAUSED:
                        player_wrapper.onPlayerStop();
                        break;

                    case -1:
                    case YT.PlayerState.BUFFERING:
                    case YT.PlayerState.CUED:
                        console.debug("player status", playerStatus);
                        break;

                    default:
                        console.debug("unknown player status", playerStatus);
                        break;
                }
            });
            return player_wrapper;

        } else if (type == VideoPlayerType.PEERTUBE) {
            let player_obj = await VideoPlayer.init_peertube_player(player_data);

            let curr_time = 0;
            player_obj.addEventListener('playbackStatusUpdate', (data) => {
                curr_time = data.position;
            });
            let get_time = () => curr_time;
            let player_wrapper = new VideoPlayer(player_obj, get_time);
            player_obj.addEventListener('playbackStatusChange', (playerStatus) => {
                switch (playerStatus) {
                    case 'playing':
                        player_wrapper.onPlayerGo();
                        break;

                    case 'paused':
                        player_wrapper.onPlayerStop();
                        break;

                    default:
                        console.debug("unknown player status", playerStatus);
                        break;
                }
            });
            return player_wrapper;
        }
    }

    static async init_peertube_player(player_data) {
        await loadScript('https://unpkg.com/@peertube/embed-api/build/player.min.js');
        const PeerTubePlayer = window['PeerTubePlayer'];

        // create iframe with embedded video and replace dom target
        let video_iframe = document.createElement('iframe');
        video_iframe.src = `https://${player_data.node_name}/videos/embed/${player_data.video_id}?api=1`;
        let iframe_loaded = new Promise((resolve) => {
            video_iframe.onload = () => {resolve()};
        });
        document.querySelector('#player').replaceWith(video_iframe);
        await iframe_loaded;

        let player = new PeerTubePlayer(video_iframe);
        await player.ready;
        return player;
    }

    static async init_youtube_player(player_data) {
        let player_loaded = new Promise((resolve) => {
            // shitty youtube player uses a global callback function
            window.onYouTubeIframeAPIReady = function() {
                console.debug("onYouTubeIframeAPIReady");
                resolve();
            }
        });

        await loadScript('https://www.youtube.com/iframe_api');
        await player_loaded;

        // get starting point of video from url param if present
        let pvars = {};
        let params = new URLSearchParams(document.location.search);
        console.debug(document.location.search);
        if (params.get('t') !== null) {
            pvars['start'] = parseInt(params.get('t'))
            console.debug(pvars);
        }

        let player = await new Promise((resolve) => {
            let player = new YT.Player('player', {
                videoId: player_data.video_id,
                playerVars: pvars,
                events: {
                  'onReady': event => {resolve(event.target)}
                }
            });
        });

        return player;
    }
}

class ChatSync {
    constructor(player, chat, badges, offsets) {
        this.player = player;
        this.chat = chat;
        this.badges = badges;
        this.offsets = offsets;

        this.polling_handler = null;
        this.last_msg_idx = 0;

        this.player.onPlayerGo = this.startPolling;
        this.player.onPlayerStop = this.stopPolling;
    }

    startPolling = () => {
        if (this.polling_handler === null) {
            console.debug("polling started");
            this.polling_handler = setInterval(this.updateChat, 400);
        }
    }

    stopPolling = () => {
        if (this.polling_handler !== null) {
            console.debug("polling stopped");
            clearInterval(this.polling_handler);
            this.polling_handler = null;
        }
    }

    updateChat = () => {
        let t = this.player.getCurrentTime();

        // find where in the offsets table we are and get corresponding time offset
        let offset_idx = binarySearch(this.offsets, [t, null], (a,b) => (a[0]-b[0]));
        let t_offset = this.offsets[offset_idx-1][1];
        t += t_offset;

        let msg_idx = binarySearch(this.chat, {'t':t}, (a,b) => (a.t-b.t));
        let delta = msg_idx - this.last_msg_idx;

        if (delta > 0 && delta < 150) {
            // some messages to add, but not that many
            for (const i of range(this.last_msg_idx, msg_idx)) {
                this.appendChatMsg(i);
            }
            this.trimChatMsgs();
            this.scrollToRecentChat(delta > 15);

        } else if (delta >= 150 || delta < 0) {
            // basically load another part of chat
            this.clearChatMsgs();
            for (const i of range(Math.max(msg_idx-150, 0), msg_idx)) {
                this.appendChatMsg(i);
            }
            this.scrollToRecentChat(true);
        }

        // update last seen idx
        this.last_msg_idx = msg_idx;
    }

    appendChatMsg(n_msg) {
        let chat_msg = this.chat[n_msg];
        // create chat message
        const chat_msg_tpl = document.querySelector('#chat-msg-tpl');
        let new_chat_msg = chat_msg_tpl.content.cloneNode(true);

        // add badges
        let badge_container = new_chat_msg.querySelector('#userbadges');
        this.setBadges(badge_container, chat_msg.b);

        // set username and color
        let username_span = new_chat_msg.querySelector('.chat-username');
        username_span.textContent = chat_msg.u.n; // user.name
        username_span.style.color = chat_msg.u.c; // user.color

        let frag_container = new_chat_msg.querySelector('.chat-fragments-container');
        this.setFragments(frag_container, chat_msg.f); // fragments

        // insert msg in last place
        let chat_stop = document.querySelector('#chat-stop');
        chat_stop.parentNode.insertBefore(new_chat_msg, chat_stop);
    }

    setBadges(badge_container, msg_badges) {
        const msg_badge_tpl = document.querySelector('#msg-badge-tpl');

        for(const bdg of msg_badges) {
            let new_badge = msg_badge_tpl.content.cloneNode(true);
            let img_elem = new_badge.querySelector("img");

            // TODO what if badge is dead
            let bdg_data = this.badges.badge_sets[bdg.id].versions[bdg.v]
            img_elem.title = bdg_data.title;
            img_elem.src = bdg_data.image_url_1x;
            img_elem.srcset =  `${bdg_data.image_url_1x} 1x,
                                ${bdg_data.image_url_2x} 2x,
                                ${bdg_data.image_url_4x} 4x`;

            badge_container.appendChild(new_badge);
        }
    }

    setFragments(frag_container, fragments) {
        const msg_text_tpl = document.querySelector('#msg-text-tpl');
        const msg_emote_tpl = document.querySelector('#msg-emote-tpl');
        const msg_link_tpl = document.querySelector('#msg-link-tpl');

        for (const frag of fragments) {
            if ('t' in frag) { // text
                let text_frag = msg_text_tpl.content.cloneNode(true);
                text_frag.querySelector('.chat-fragment-text').textContent = frag.t;
                frag_container.appendChild(text_frag);

            } else if ('e' in frag) { // emoticon
                let emote_frag = msg_emote_tpl.content.cloneNode(true);
                let emote_img = emote_frag.querySelector('.chat-emote');
                emote_img.alt =    frag.e.n;
                emote_img.title =    frag.e.n;
                emote_img.src =    `https://static-cdn.jtvnw.net/emoticons/v2/${frag.e.id}/default/light/1.0`;
                emote_img.srcset = `https://static-cdn.jtvnw.net/emoticons/v2/${frag.e.id}/default/light/1.0 1x,
                                    https://static-cdn.jtvnw.net/emoticons/v2/${frag.e.id}/default/light/2.0 2x,
                                    https://static-cdn.jtvnw.net/emoticons/v2/${frag.e.id}/default/light/3.0 4x`;

                let on_super_dead_emote = () => {
                    // emote is fucking dead, replace emote with text
                    let text_frag = msg_text_tpl.content.cloneNode(true);
                    text_frag.querySelector('.chat-fragment-text').textContent = frag.e.n;

                    frag_container.replaceChild(text_frag, emote_img.parentNode.parentNode);
                    console.debug('dead emote replaced with text');
                };
                // emote is dead, but try cache
                let on_dead_emote = () => {
                    emote_img.onerror = on_super_dead_emote;
                    emote_img.removeAttribute("srcset");
                    emote_img.src = `https://github.com/joevods/vodbkp/raw/main/cache/emotes/${frag.e.id}.png`;
                    console.debug('dead emote replaced with cached', emote_img);
                };
                emote_img.onerror = on_dead_emote;

                frag_container.appendChild(emote_frag);

            } else if ('l' in frag) {
                let link_frag = msg_link_tpl.content.cloneNode(true);
                let link_a = link_frag.querySelector('.chat-fragment-link');
                link_a.href = frag.l;
                link_a.textContent = frag.l;
                frag_container.appendChild(link_frag);

            } else {
                console.error('unexpected fragment type', frag);
            }
        }
    }

    trimChatMsgs() {
        // remove overflow messages
        let dom_msg = document.querySelectorAll('.chat-messages-container>.chat-message');
        if (dom_msg.length > 150) {
            [...dom_msg].slice(0, dom_msg.length - 150).forEach(el => el.remove());
        }
    }

    clearChatMsgs() {
        // remove all messages
        document.querySelectorAll('.chat-messages-container>.chat-message').forEach(el => el.remove());
    }

    scrollToRecentChat(fast) {
        // scroll to bottom of chat
        if (fast) {
            console.debug('fast scroll');
            document.querySelector('#chat-stop').scrollIntoView({ behavior: 'auto', block: 'end' });
        } else {
            console.debug('smooth scroll');
            document.querySelector('#chat-stop').scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }
}


async function init_player_and_chat() {
    let urlParams = new URLSearchParams(window.location.search);
    if (!urlParams.has('vod')) {
      window.location.replace("/");
    }
    let vod_id = parseInt(urlParams.get('vod'));

    let data = await fetch(`https://raw.githubusercontent.com/joevods/vodbkp/main/cache/vods/${vod_id}/video_info.json`)
        .catch(error => window.location.replace("/"))
        .then(response => response.json())
        .catch(error => console.error(error));

    // load data asyncronously
    let [player, global_badges, channel_badges, chat] = await Promise.all([
        VideoPlayer.build(data.player_type, data.player_data),
        fetch('https://badges.twitch.tv/v1/badges/global/display').then(response => response.json()),
        fetch(`https://badges.twitch.tv/v1/badges/channels/${data.channel_id}/display`).then(response => response.json()),
        fetch(`https://raw.githubusercontent.com/joevods/vodbkp/main/cache/vods/${vod_id}/chat_web.json`).then(response => response.json()),
    ])
    // merge global and channel badges
    const badges = {
        'badge_sets': {
            ...global_badges.badge_sets,
            ...channel_badges.badge_sets,
        }
    }

    new ChatSync(player, chat, badges, data.offsets);
}
